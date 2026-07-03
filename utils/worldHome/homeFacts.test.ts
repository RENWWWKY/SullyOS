import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveHomeWorld, buildHomeWorldScheduleBlock } from './homeFacts';
import { DB } from '../db';
import type { CharacterProfile, WorldProfile, WorldEpisode } from '../../types';

vi.mock('../db', () => ({
    DB: {
        getWorlds: vi.fn(),
        getAllCharacters: vi.fn(),
        getWorldEpisodes: vi.fn(),
        getDailySchedule: vi.fn(),
    },
}));

const CHAR_ID = 'char_a';

function makeChar(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
    return { id: CHAR_ID, name: '阿澄', ...overrides } as CharacterProfile;
}

function makeWorld(overrides: Partial<WorldProfile> = {}): WorldProfile {
    return {
        id: 'world_1',
        name: '小镇',
        worldview: '海边小镇的日常',
        mode: 'light',
        memberIds: [CHAR_ID],
        npcs: [],
        houses: [],
        relationships: [],
        storyClock: 0,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as WorldProfile;
}

beforeEach(() => {
    vi.mocked(DB.getWorlds).mockResolvedValue([]).mockClear();
    vi.mocked(DB.getAllCharacters).mockResolvedValue([]).mockClear();
    vi.mocked(DB.getWorldEpisodes).mockResolvedValue([]).mockClear();
    vi.mocked(DB.getDailySchedule).mockResolvedValue(null as any).mockClear();
});

describe('resolveHomeWorld 主家园判定', () => {
    it('恰好在 1 个 real 世界 → 该世界即主家园', async () => {
        const w = makeWorld();
        vi.mocked(DB.getWorlds).mockResolvedValue([w]);
        expect(await resolveHomeWorld(makeChar())).toEqual(w);
    });

    it('timeMode 缺省按 real 处理（旧世界兼容）', async () => {
        const w = makeWorld({ timeMode: undefined });
        vi.mocked(DB.getWorlds).mockResolvedValue([w]);
        expect((await resolveHomeWorld(makeChar()))?.id).toBe('world_1');
    });

    it('sim 世界不算主家园（番外坚决不注入）', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([makeWorld({ timeMode: 'sim' })]);
        expect(await resolveHomeWorld(makeChar())).toBeNull();
    });

    it('injectToChat=false 的世界不算主家园（与 entersMemory 同口径）', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([makeWorld({ injectToChat: false })]);
        expect(await resolveHomeWorld(makeChar())).toBeNull();
    });

    it('角色不是成员的世界不算', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([makeWorld({ memberIds: ['someone_else'] })]);
        expect(await resolveHomeWorld(makeChar())).toBeNull();
    });

    it('同时在多个 real 世界且未指定 primaryHomeId → 含糊不猜，返回 null', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([
            makeWorld({ id: 'w1' }),
            makeWorld({ id: 'w2' }),
        ]);
        expect(await resolveHomeWorld(makeChar())).toBeNull();
    });

    it('多个 real 世界但 primaryHomeId 已指定 → 用指定的', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([
            makeWorld({ id: 'w1' }),
            makeWorld({ id: 'w2' }),
        ]);
        const home = await resolveHomeWorld(makeChar({ primaryHomeId: 'w2' }));
        expect(home?.id).toBe('w2');
    });

    it('primaryHomeId 指向已失效世界（降级 sim/已删）→ 按未指定规则回退', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([
            makeWorld({ id: 'w1' }),
            makeWorld({ id: 'w2', timeMode: 'sim' }),
        ]);
        // 指定的 w2 是 sim：回退后恰好剩 1 个 real → w1
        const home = await resolveHomeWorld(makeChar({ primaryHomeId: 'w2' }));
        expect(home?.id).toBe('w1');
    });
});

describe('buildHomeWorldScheduleBlock 事实块', () => {
    it('无主家园 → 空串（日程行为与从前一致）', async () => {
        expect(await buildHomeWorldScheduleBlock(makeChar())).toBe('');
    });

    it('含住所/同住人/世界名/近况，且以既定事实口吻收尾', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([makeWorld({
            memberIds: [CHAR_ID, 'char_b'],
            houses: [{ id: 'h1', name: '2号小屋', residentIds: [CHAR_ID, 'char_b', 'npc_1'] }],
            npcs: [{ id: 'npc_1', name: '老板娘', persona: '面包店老板娘' }],
        })]);
        vi.mocked(DB.getAllCharacters).mockResolvedValue([
            makeChar(),
            { id: 'char_b', name: '小北' } as CharacterProfile,
        ]);
        vi.mocked(DB.getWorldEpisodes).mockResolvedValue([
            { storyTime: '第3天 白天', summary: '镇上办了集市。' } as WorldEpisode,
        ]);

        const block = await buildHomeWorldScheduleBlock(makeChar());
        expect(block).toContain('「小镇」');
        expect(block).toContain('2号小屋');
        expect(block).toContain('小北');
        expect(block).toContain('老板娘'); // NPC 同住人也解析名字
        expect(block).toContain('第3天 白天：镇上办了集市。');
        expect(block).toContain('不得与之相悖');
    });

    it('不在任何小屋 → 独居', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([makeWorld()]);
        const block = await buildHomeWorldScheduleBlock(makeChar());
        expect(block).toContain('独居');
    });

    it('同住人已生成日程 → 注入全天 slots 咬合（对齐轴③）', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([makeWorld({
            memberIds: [CHAR_ID, 'char_b'],
            houses: [{ id: 'h1', name: '2号小屋', residentIds: [CHAR_ID, 'char_b'] }],
        })]);
        vi.mocked(DB.getAllCharacters).mockResolvedValue([
            makeChar(),
            { id: 'char_b', name: '小北' } as CharacterProfile,
        ]);
        vi.mocked(DB.getDailySchedule).mockResolvedValue({
            id: 'char_b_2026-07-03', charId: 'char_b', date: '2026-07-03',
            slots: [
                { startTime: '08:00', activity: '晨跑', location: '河边' },
                { startTime: '19:00', activity: '和阿澄一起做饭', location: '厨房' },
            ],
            generatedAt: 0,
        } as any);

        const block = await buildHomeWorldScheduleBlock(makeChar());
        expect(block).toContain('「小北」今天的安排');
        // 全天蓝图：早晚两个 slot 都在（不是只有"当前时段"）
        expect(block).toContain('08:00 晨跑（河边）');
        expect(block).toContain('19:00 和阿澄一起做饭（厨房）');
        expect(block).toContain('接得上');
    });

    it('同住人今天还没生成日程 → 不注入咬合段（锚是涌现的）', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([makeWorld({
            memberIds: [CHAR_ID, 'char_b'],
            houses: [{ id: 'h1', name: '2号小屋', residentIds: [CHAR_ID, 'char_b'] }],
        })]);
        vi.mocked(DB.getAllCharacters).mockResolvedValue([
            makeChar(),
            { id: 'char_b', name: '小北' } as CharacterProfile,
        ]);
        vi.mocked(DB.getDailySchedule).mockResolvedValue(null as any);

        const block = await buildHomeWorldScheduleBlock(makeChar());
        expect(block).not.toContain('已定的日程');
        expect(block).not.toContain('「小北」今天的安排');
        expect(block).toContain('2号小屋'); // 住所事实照常注入
    });

    it('NPC 同住人不参与日程咬合（只有名字）', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([makeWorld({
            houses: [{ id: 'h1', name: '2号小屋', residentIds: [CHAR_ID, 'npc_1'] }],
            npcs: [{ id: 'npc_1', name: '老板娘', persona: '面包店老板娘' }],
        })]);
        vi.mocked(DB.getAllCharacters).mockResolvedValue([makeChar()]);

        const block = await buildHomeWorldScheduleBlock(makeChar());
        expect(block).toContain('老板娘');
        expect(DB.getDailySchedule).not.toHaveBeenCalled();
    });

    it('近况摘要每条截断 200 字', async () => {
        vi.mocked(DB.getWorlds).mockResolvedValue([makeWorld()]);
        vi.mocked(DB.getWorldEpisodes).mockResolvedValue([
            { storyTime: '第1天 白天', summary: '长'.repeat(500) } as WorldEpisode,
        ]);
        const block = await buildHomeWorldScheduleBlock(makeChar());
        const line = block.split('\n').find(l => l.startsWith('- 第1天'))!;
        expect(line.length).toBeLessThanOrEqual('- 第1天 白天：'.length + 200);
    });
});
