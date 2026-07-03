/**
 * 主家园事实（生活三层派生链 · 对齐轴①，docs/life-layers-design.md）
 *
 * 把角色主家园的结构化事实（住哪 · 和谁同住 · 世界近况）拍成一段 prompt 块，
 * 喂给日程生成（scheduleGenerator），让日程结构上不可能与家园相悖——
 * 此前日程只能靠记忆宫殿偶然召回的碎片去猜「我住哪」。
 *
 * 主家园判定与 engine.ts 的 entersMemory 同一口径：
 * timeMode !== 'sim' 且 injectToChat !== false（即「对齐真实时间、注入记忆」的世界）。
 * sim 番外世界坚决不参与（已拍板：不进记忆、不进日程、不进小屋）。
 */

import { CharacterProfile, DailySchedule, WorldProfile } from '../../types';
import { DB } from '../db';

/** 与 engine.ts entersMemory 同口径的「real 家园」判定。 */
function isRealHomeWorld(world: WorldProfile): boolean {
    return (world.timeMode ?? 'real') !== 'sim' && world.injectToChat !== false;
}

/** 列出角色所在的全部 real 家园（主家园候选）。选择器 UI（阶段C）与判定共用。 */
export async function listRealHomeWorldsFor(charId: string): Promise<WorldProfile[]> {
    const worlds = await DB.getWorlds().catch(() => [] as WorldProfile[]);
    return worlds.filter(w => isRealHomeWorld(w) && (w.memberIds || []).includes(charId));
}

/**
 * 解析角色的主家园。
 * 1. char.primaryHomeId 已设且世界仍是 real 家园 → 直接用（用户手动指定优先）。
 * 2. 未设：恰好只在 1 个 real 世界 → 视为主家园；0 个或多个 → null（含糊不猜，等用户指定）。
 */
export async function resolveHomeWorld(char: CharacterProfile): Promise<WorldProfile | null> {
    const realHomes = await listRealHomeWorldsFor(char.id);
    if (realHomes.length === 0) return null;
    if (char.primaryHomeId) {
        const designated = realHomes.find(w => w.id === char.primaryHomeId);
        if (designated) return designated;
        // 指定的世界已删/降级为 sim/退出成员：不悄悄换成别的，按未指定规则走
    }
    return realHomes.length === 1 ? realHomes[0] : null;
}

/**
 * 构建喂给日程生成 prompt 的「主家园事实」块。
 * 无主家园（不在任何 real 世界 / 多个 real 世界含糊）时返回空串，日程退回现状行为。
 *
 * 近况喂 episode.summary（引擎本就把它喂给下一轮全体角色做连续性，不含 shared=false
 * 的私密 timeline，无上帝视角风险）；不喂其他角色的私人 narrative。
 */
export async function buildHomeWorldScheduleBlock(char: CharacterProfile): Promise<string> {
    const world = await resolveHomeWorld(char);
    if (!world) return '';

    const lines: string[] = [];
    lines.push(`## 你的家园「${world.name}」（既定事实，日程不得与之相悖）`);
    if (world.worldview?.trim()) {
        lines.push(`世界观：${world.worldview.trim().slice(0, 200)}`);
    }

    // 住所与同住人（不在任何小屋 = 独居，见 WorldHouse 注释）
    const house = (world.houses || []).find(h => (h.residentIds || []).includes(char.id));
    const roommateChars: CharacterProfile[] = [];
    if (house) {
        const roommateIds = house.residentIds.filter(id => id !== char.id);
        const chars = await DB.getAllCharacters().catch(() => [] as CharacterProfile[]);
        const roommateNames = roommateIds
            .map(id => chars.find(c => c.id === id)?.name || world.npcs?.find(n => n.id === id)?.name || '')
            .filter(Boolean);
        lines.push(roommateNames.length > 0
            ? `你住在「${house.name}」，和 ${roommateNames.join('、')} 同住。`
            : `你住在「${house.name}」，目前一个人住。`);
        // 只有真实角色才有日程；NPC 有名字但不参与咬合
        for (const id of roommateIds) {
            const c = chars.find(x => x.id === id);
            if (c) roommateChars.push(c);
        }
    } else {
        lines.push(`你在这个世界里独居，有自己的住处。`);
    }

    // 对齐轴③（同住人日程咬合）：捞今天**已生成**的同住人日程，后生成的向先生成的看齐。
    // 锚是涌现的——当天谁先生成谁是锚，这里只管"看齐所有已生成的"。
    // 注意读的是原始全天 slots（整天蓝图），不是 buildScheduleInjection 的"此刻快照"。
    const today = new Date().toISOString().split('T')[0];
    const roommateBlocks: string[] = [];
    for (const rc of roommateChars) {
        const rs: DailySchedule | null = await DB.getDailySchedule(rc.id, today).catch(() => null);
        if (!rs?.slots?.length) continue;
        const slotLines = rs.slots.map(s =>
            `  - ${s.startTime} ${s.activity}${s.location ? `（${s.location}）` : ''}`);
        roommateBlocks.push(`「${rc.name}」今天的安排：\n${slotLines.join('\n')}`);
    }
    if (roommateBlocks.length > 0) {
        lines.push(`同住人今天已定的日程（你们住在一起，你的日程要接得上：共同活动要呼应、同一时段不要互相矛盾——ta 说晚上和你做饭，你就别安排独自健身）：`);
        lines.push(...roommateBlocks);
    }

    // 家园近况：最近 2 轮的机械梗概，各截 200 字
    const episodes = await DB.getWorldEpisodes(world.id, 2).catch(() => []);
    const recent = episodes
        .filter(e => e.summary?.trim())
        .map(e => `- ${e.storyTime}：${e.summary.trim().slice(0, 200)}`);
    if (recent.length > 0) {
        lines.push(`最近这个世界发生的事（新在前）：`);
        lines.push(...recent);
    }

    lines.push(`（今天的日程要落在这个家园的生活里：住所、同住人、社会关系以上述事实为准；家园近况可以自然影响你今天的安排，但不要凭空搬去别的住处或虚构别的同居人。）`);
    return `\n${lines.join('\n')}\n`;
}
