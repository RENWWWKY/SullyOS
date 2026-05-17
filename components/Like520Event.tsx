/**
 * Like520Event.tsx
 * 520 特别活动 (2026.5.20) — "如果 char 变得小小的"
 *
 * Phase 状态机：
 *   intro → char_creator → loading_a → opening → tucao_select → tucao_reply
 *   → anchors → reveal_transition → user_creator → uncovered_line → ending_screen
 *   → loading_b → wake_up → letter → puzzle → done
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, SpecialMomentRecord } from '../types';
import {
    runLike520CallA,
    runLike520CallB,
    Like520CallAResult,
    Like520CallBResult,
    Like520TucaoKey,
} from '../utils/like520/prompts';

// ============================================================
// 日期判定 / 持久化 key
// ============================================================

export const LIKE520_RECORD_KEY = 'like520_2026';
const LIKE520_DISMISSED_KEY = 'sullyos_like520_2026_dismissed';
const LIKE520_COMPLETED_KEY = 'sullyos_like520_2026_completed';

const isLike520Day = (): boolean => {
    const now = new Date();
    return now.getFullYear() === 2026 && now.getMonth() === 4 && now.getDate() === 20;
};

export const shouldShowLike520Popup = (): boolean => {
    if (!isLike520Day()) return false;
    try {
        if (localStorage.getItem(LIKE520_DISMISSED_KEY)) return false;
        if (localStorage.getItem(LIKE520_COMPLETED_KEY)) return false;
    } catch { /* ignore */ }
    return true;
};

export const isLike520EventAvailable = (): boolean => {
    const now = new Date();
    return now.getFullYear() === 2026 && now.getMonth() === 4;
};

export const isLike520Past = (): boolean => {
    const now = new Date();
    return now.getFullYear() > 2026 || (now.getFullYear() === 2026 && now.getMonth() > 4);
};

// ============================================================
// 类型
// ============================================================

type Phase =
    | 'intro' | 'char_creator' | 'loading_a'
    | 'yangcheng'           // 持久化养成容器：opening → tucao → 锚点 → reveal_transition → 自我意识
    | 'user_creator' | 'uncovered_line' | 'ending_screen'
    | 'loading_b' | 'wake_up' | 'letter' | 'puzzle' | 'done' | 'error';

interface ChibiResult {
    dataUrl: string;
    frameDataUrl: string;
    transparentDataUrl: string;
    state?: any;
}

const TUCAO_OPTIONS: { key: Like520TucaoKey; label: string }[] = [
    { key: 'becamesmall', label: '你怎么变小了！' },
    { key: 'cute', label: '你今天好可爱！' },
    { key: 'yangcheng_meta', label: '这什么天杀的养成游戏' },
];

// ============================================================
// Sully 识别（专属预设）
// ============================================================

const isSullyChar = (char: CharacterProfile): boolean => {
    return (char.name || '').toLowerCase().includes('sully');
};

const sullyPresets = (): Record<string, string> => ({
    skin: 'skin_1',
    fronthair: 'fronthair_99',
    eyes: 'eyes_99',
});

// ============================================================
// iframe 捏脸 wrapper
// ============================================================

interface CreatorIframeProps {
    mode: 'char' | 'user';
    charName?: string;
    presets?: Record<string, string>;
    onConfirm: (result: ChibiResult) => void;
}

const CHAR_CREATOR_URL = (((import.meta as any).env?.BASE_URL ?? '/') + 'like520/character_creator.html').replace(/\/+/g, '/');

const CreatorIframe: React.FC<CreatorIframeProps> = ({ mode, charName, presets, onConfirm }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        const handleMessage = (e: MessageEvent) => {
            if (!e.data || typeof e.data !== 'object') return;
            const iframeWin = iframeRef.current?.contentWindow;
            if (e.source !== iframeWin) return;

            if (e.data.type === 'like520_ready') {
                console.log(`[520][creator:${mode}] iframe ready, sending init`);
                iframeWin?.postMessage({
                    type: 'like520_init',
                    payload: { mode, charName, presets },
                }, '*');
            } else if (e.data.type === 'like520_result' && e.data.payload) {
                console.log(`[520][creator:${mode}] result received`);
                onConfirm({
                    dataUrl: e.data.payload.dataUrl,
                    frameDataUrl: e.data.payload.frameDataUrl,
                    transparentDataUrl: e.data.payload.transparentDataUrl,
                    state: e.data.payload.state,
                });
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [mode, charName, presets, onConfirm]);

    return (
        <iframe
            ref={iframeRef}
            src={CHAR_CREATOR_URL}
            title={mode === 'char' ? '捏 char chibi' : '捏 user chibi'}
            className="w-full h-full border-0"
            style={{ background: 'linear-gradient(180deg, #FFF1E6 0%, #FFE4EC 100%)' }}
        />
    );
};

// ============================================================
// 小工具：galgame 风格对白盒（白底 + 名牌 + ▽）
// ============================================================

const DialogueBox: React.FC<{
    charName: string;
    text?: string;
    children?: React.ReactNode;
    onAdvance?: () => void;
    showArrow?: boolean;
    arrowGlyph?: string;
    minHeight?: number;
    pageInfo?: string;
}> = ({ charName, text, children, onAdvance, showArrow, arrowGlyph = '▽', minHeight = 110, pageInfo }) => (
    <div
        onClick={onAdvance}
        className={`relative rounded-2xl p-5 pb-4 ${onAdvance ? 'cursor-pointer active:opacity-90' : ''}`}
        style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(255,248,241,0.97) 100%)',
            boxShadow: '0 8px 24px rgba(199, 97, 130, 0.2), inset 0 0 0 2px rgba(212, 165, 116, 0.25)',
            minHeight: `${minHeight}px`,
        }}
    >
        <div className="absolute -top-2 left-4 bg-[#5C3A2E] text-white text-[11px] font-bold px-3 py-1 rounded-lg shadow tracking-wider">
            {charName}
        </div>
        {pageInfo && (
            <div className="absolute -top-2 right-4 bg-white/95 text-[#9D7585] text-[10px] font-bold px-2.5 py-0.5 rounded-lg shadow border border-[#FCEDD9]">
                {pageInfo}
            </div>
        )}
        {children}
        {text !== undefined && (
            <div className="text-[#5C3A4A] text-[14px] leading-[1.85] pt-2 whitespace-pre-wrap animate-fade-in">
                {text}
            </div>
        )}
        {showArrow && (
            <div className="absolute bottom-2 right-3 text-[#C76182]/70 text-sm animate-pulse">
                {arrowGlyph}
            </div>
        )}
    </div>
);

// ============================================================
// ChoiceOverlay — 居中浮层选项（galgame 选择菜单）
// 不框在对话框里，覆盖在场景中央
// ============================================================

interface ChoiceOverlayProps {
    prompt?: string;
    options: { key: string; label: string }[];
    onPick: (key: string) => void;
}

const ChoiceOverlay: React.FC<ChoiceOverlayProps> = ({ prompt, options, onPick }) => (
    <div className="absolute inset-0 z-[40] flex flex-col items-center justify-center px-6 animate-fade-in pointer-events-none">
        <div className="absolute inset-0 bg-black/35 backdrop-blur-[1px] pointer-events-auto" />
        <div className="relative w-full max-w-[18rem] flex flex-col items-center gap-3 pointer-events-auto">
            {prompt && (
                <div className="text-white text-xs tracking-[6px] mb-1 drop-shadow-lg">{prompt}</div>
            )}
            {options.map((opt, i) => (
                <button
                    key={opt.key}
                    onClick={() => onPick(opt.key)}
                    className="w-full px-5 py-3 rounded-2xl bg-white/95 text-[#5C3A4A] text-[14px] font-medium shadow-xl active:scale-95 active:bg-[#FFE4D5] transition-all border-2 border-white"
                    style={{
                        animation: `fadeSlideIn 0.3s ease ${i * 80}ms backwards`,
                    }}
                >
                    {opt.label}
                </button>
            ))}
        </div>
        <style>{`
            @keyframes fadeSlideIn {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `}</style>
    </div>
);

// ============================================================
// Y520Scene — 持久化养成场景容器
// 覆盖 opening → 吐槽选择 → 吐槽回应 → free（锚点+抚摸）→ reveal_transition → 自我意识
// ============================================================

type Y520Stage =
    | 'opening'
    | 'tucao_choose'
    | 'tucao_reply'
    | 'free'
    | 'anchor_action_choose'   // 道具点击后弹居中选项
    | 'anchor_playing'         // 选完动作后 char 回应
    | 'touch_playing'
    | 'reveal'
    | 'self_reveal_hint'       // "你下意识低头看了看自己——"
    | 'self_reveal_choose';    // 选项浮层："诶？" 等

const SELF_REVEAL_HINT_LINES = ['（你下意识低头看了看自己——）'];
const SELF_REVEAL_OPTIONS: { key: string; label: string }[] = [
    { key: 'eh', label: '「诶？」' },
    { key: 'silence', label: '「……」' },
    { key: 'look', label: '（你仔细看了看）' },
];

interface Y520SceneProps {
    callA: Like520CallAResult;
    charName: string;
    charAvatar?: string;
    charChibiUrl: string;
    onTucaoSelected: (key: Like520TucaoKey) => void;
    onComplete: () => void;
}

const Y520Scene: React.FC<Y520SceneProps> = ({ callA, charName, charAvatar, charChibiUrl, onTucaoSelected, onComplete }) => {
    const [stage, setStage] = useState<Y520Stage>('opening');
    const [queue, setQueue] = useState<string[]>(callA.opening);
    const [lineIdx, setLineIdx] = useState(0);
    const [usedAnchors, setUsedAnchors] = useState<Set<number>>(new Set());
    const [activeAnchorIdx, setActiveAnchorIdx] = useState<number | null>(null);
    const [touchIdx, setTouchIdx] = useState(0);

    const allAnchorsUsed = usedAnchors.size >= callA.anchors.length;
    const currentLine = queue[lineIdx];
    const hasMoreLines = lineIdx < queue.length - 1;
    const moodPct = Math.min(100, Math.round((usedAnchors.size / Math.max(callA.anchors.length, 1)) * 100));

    // free 阶段 + 所有锚点用完 → 自动进入 reveal
    useEffect(() => {
        if (stage === 'free' && allAnchorsUsed) {
            const t = setTimeout(() => {
                setQueue(callA.reveal_transition);
                setLineIdx(0);
                setStage('reveal');
            }, 700);
            return () => clearTimeout(t);
        }
    }, [stage, allAnchorsUsed, callA.reveal_transition]);

    const advance = () => {
        if (!queue.length) return;
        if (hasMoreLines) {
            setLineIdx(i => i + 1);
            return;
        }
        // 最后一行 → 阶段切换
        if (stage === 'opening') {
            setStage('tucao_choose');
            setQueue([]);
            setLineIdx(0);
        } else if (stage === 'tucao_reply') {
            setStage('free');
            setQueue([]);
            setLineIdx(0);
        } else if (stage === 'anchor_playing') {
            if (activeAnchorIdx !== null) {
                setUsedAnchors(prev => new Set(prev).add(activeAnchorIdx));
            }
            setActiveAnchorIdx(null);
            setChosenUserAction(null);
            setStage('free');
            setQueue([]);
            setLineIdx(0);
        } else if (stage === 'touch_playing') {
            setStage('free');
            setQueue([]);
            setLineIdx(0);
        } else if (stage === 'reveal') {
            setQueue(SELF_REVEAL_HINT_LINES);
            setLineIdx(0);
            setStage('self_reveal_hint');
        } else if (stage === 'self_reveal_hint') {
            // 唯一一行播完 → 弹选项（不让 char 替 user 说"诶？"）
            setQueue([]);
            setLineIdx(0);
            setStage('self_reveal_choose');
        }
    };

    const pickSelfReveal = (_key: string) => {
        if (stage !== 'self_reveal_choose') return;
        onComplete();
    };

    const pickTucao = (key: Like520TucaoKey) => {
        if (stage !== 'tucao_choose') return;
        onTucaoSelected(key);
        setQueue(callA.tucao_responses[key]);
        setLineIdx(0);
        setStage('tucao_reply');
    };

    const [chosenUserAction, setChosenUserAction] = useState<string | null>(null);

    const startAnchor = (idx: number) => {
        if (stage !== 'free' || usedAnchors.has(idx)) return;
        setActiveAnchorIdx(idx);
        setChosenUserAction(null);
        setStage('anchor_action_choose');
    };

    const pickUserAction = (action: string) => {
        if (stage !== 'anchor_action_choose' || activeAnchorIdx === null) return;
        setChosenUserAction(action);
        setQueue(callA.anchors[activeAnchorIdx].dialogue);
        setLineIdx(0);
        setStage('anchor_playing');
    };

    const touchChibi = () => {
        if (stage !== 'free' || callA.touch_lines.length === 0) return;
        const line = callA.touch_lines[touchIdx % callA.touch_lines.length];
        setQueue([line]);
        setLineIdx(0);
        setStage('touch_playing');
        setTouchIdx(i => i + 1);
    };

    // 当锚点回应播完，scene 旁白也要清掉
    const activeAnchor = activeAnchorIdx !== null ? callA.anchors[activeAnchorIdx] : null;
    const showSceneNarration = stage === 'anchor_playing' && activeAnchor;
    const nameTag = stage === 'self_reveal_hint' ? '——' : charName;
    const itemsCols = callA.anchors.length > 6 ? 'grid-cols-4' : 'grid-cols-3';

    return (
        <div className="relative flex flex-col h-full max-w-md mx-auto overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0 relative z-10">
                <div className="flex items-center gap-2 bg-[#5C3A2E]/90 rounded-full pl-1 pr-3 py-1 shadow">
                    {charAvatar?.startsWith('http') || charAvatar?.startsWith('data:') ? (
                        <img src={charAvatar} alt={charName} className="w-7 h-7 rounded-full object-cover border-2 border-[#FFE4D5]" />
                    ) : (
                        <div className="w-7 h-7 rounded-full bg-[#FFE4D5] flex items-center justify-center text-sm">{charAvatar || '🌸'}</div>
                    )}
                    <span className="text-white text-xs font-bold tracking-wider">{charName}</span>
                </div>
                <div className="flex-1 flex items-center gap-2 bg-[#5C3A2E]/90 rounded-full px-3 py-1.5 shadow">
                    <span className="text-[#FF6B7A] text-sm">❤</span>
                    <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-[#FFB6C8] to-[#F18AAA] transition-all duration-700" style={{ width: `${moodPct}%` }} />
                    </div>
                </div>
            </div>

            {/* Shelf (items) */}
            <div className="px-3 pt-1 pb-1 shrink-0 relative z-10">
                <div className={`grid gap-1.5 ${itemsCols}`}>
                    {callA.anchors.map((a, i) => {
                        const used = usedAnchors.has(i);
                        const tappable = stage === 'free' && !used;
                        return (
                            <button
                                key={i}
                                onClick={() => startAnchor(i)}
                                disabled={!tappable}
                                className={`aspect-square flex flex-col items-center justify-center rounded-xl border-2 transition-all ${
                                    used
                                        ? 'bg-white/30 border-white/30 opacity-30'
                                        : tappable
                                            ? 'bg-white border-[#FCEDD9] active:scale-95 hover:bg-[#FFF8F1] shadow'
                                            : 'bg-white/60 border-[#FCEDD9]/40 cursor-not-allowed'
                                }`}
                            >
                                <span className="text-2xl leading-none">{a.item_icon}</span>
                                <span className="text-[9px] mt-0.5 text-[#5C3A4A] font-bold tracking-wider truncate w-full px-0.5">
                                    {used ? '·' : a.item_label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Chibi area */}
            <div className="flex-1 flex items-center justify-center min-h-0 relative z-10">
                <button
                    onClick={touchChibi}
                    disabled={stage !== 'free'}
                    className={`relative h-full max-h-full flex items-center justify-center ${stage === 'free' ? 'cursor-pointer active:scale-95' : ''} transition-transform`}
                    title={stage === 'free' ? '摸摸 ta' : ''}
                >
                    <img src={charChibiUrl} alt="chibi" className="max-h-full max-w-[70%] object-contain drop-shadow-md" />
                </button>
                {showSceneNarration && chosenUserAction && (
                    <div className="absolute top-1 left-0 right-0 px-4 animate-fade-in pointer-events-none">
                        <div className="text-center text-[12px] italic text-[#5C3A4A] bg-white/70 backdrop-blur rounded-full px-4 py-1.5 inline-block mx-auto shadow">
                            （{chosenUserAction}）
                        </div>
                    </div>
                )}
            </div>

            {/* Galgame dialogue box */}
            <div className="px-3 pb-3 pt-2 shrink-0 relative z-10">
                <DialogueBox
                    charName={nameTag}
                    onAdvance={stage === 'tucao_choose' || stage === 'anchor_action_choose' || stage === 'self_reveal_choose' ? undefined : (queue.length > 0 ? advance : undefined)}
                    showArrow={!!(queue.length > 0 && stage !== 'tucao_choose' && stage !== 'anchor_action_choose' && stage !== 'self_reveal_choose')}
                    arrowGlyph={stage === 'self_reveal_hint' && !hasMoreLines ? '→' : '▽'}
                >
                    {currentLine ? (
                        <div key={`${stage}-${lineIdx}`} className="text-[#5C3A4A] text-[14px] leading-[1.85] pt-2 whitespace-pre-wrap animate-fade-in">
                            {currentLine}
                        </div>
                    ) : (
                        <div className="text-[#9D7585]/70 text-[12px] italic pt-2">
                            （{
                                stage === 'tucao_choose' ? '你的反应是——'
                                : stage === 'anchor_action_choose' ? '你要做什么呢——'
                                : stage === 'self_reveal_choose' ? '……'
                                : stage === 'free' && !allAnchorsUsed ? `摸摸 ${charName}，或者从架子上拿一样`
                                : '……'
                            }）
                        </div>
                    )}
                </DialogueBox>
            </div>

            {/* 居中浮层选项 */}
            {stage === 'tucao_choose' && (
                <ChoiceOverlay
                    prompt="你 的 反 应"
                    options={TUCAO_OPTIONS.map(o => ({ key: o.key, label: `「${o.label}」` }))}
                    onPick={(k) => pickTucao(k as Like520TucaoKey)}
                />
            )}
            {stage === 'anchor_action_choose' && activeAnchor && (
                <ChoiceOverlay
                    prompt={`你 要 ${activeAnchor.item_label}`}
                    options={activeAnchor.user_action_options.map((label, i) => ({ key: String(i), label }))}
                    onPick={(k) => pickUserAction(activeAnchor.user_action_options[Number(k)])}
                />
            )}
            {stage === 'self_reveal_choose' && (
                <ChoiceOverlay
                    prompt="你 的 反 应"
                    options={SELF_REVEAL_OPTIONS}
                    onPick={pickSelfReveal}
                />
            )}
        </div>
    );
};

// ============================================================
// LineQueueView — 短数组对白序列（用于 wake_up）
// ============================================================

const LineQueueView: React.FC<{
    lines: string[];
    charName: string;
    onComplete: () => void;
    bgGradient?: string;
}> = ({ lines, charName, onComplete, bgGradient }) => {
    const [idx, setIdx] = useState(0);
    const isLast = idx >= lines.length - 1;
    return (
        <div className="flex flex-col h-full max-w-md mx-auto justify-end px-3 pb-8" style={bgGradient ? { background: bgGradient } : undefined}>
            <DialogueBox
                charName={charName}
                onAdvance={() => { if (isLast) onComplete(); else setIdx(i => i + 1); }}
                showArrow={true}
                arrowGlyph={isLast ? '→' : '▽'}
            >
                <div key={idx} className="text-[#5C3A4A] text-[15px] leading-[1.9] pt-2 whitespace-pre-wrap animate-fade-in">
                    {lines[idx]}
                </div>
            </DialogueBox>
        </div>
    );
};

// ============================================================
// UncoveredLineView — 第二次捏脸后那段长篇真心话
// 双 chibi 居中 + galgame 长对白盒推进
// ============================================================

const UncoveredLineView: React.FC<{
    lines: string[];
    charName: string;
    charAvatar?: string;
    charChibi: string;
    userChibi: string;
    onComplete: () => void;
}> = ({ lines, charName, charAvatar, charChibi, userChibi, onComplete }) => {
    const [idx, setIdx] = useState(0);
    const isLast = idx >= lines.length - 1;

    const advance = () => {
        if (isLast) onComplete();
        else setIdx(i => i + 1);
    };

    return (
        <div
            className="relative flex flex-col h-full w-full max-w-md mx-auto overflow-hidden"
            style={{ background: 'linear-gradient(180deg, #FFF1E6 0%, #FFE4EC 45%, #FFD1DC 100%)' }}
        >
            {/* Header (name tag) */}
            <div className="px-3 pt-3 pb-1 shrink-0">
                <div className="flex items-center gap-2 bg-[#5C3A2E]/90 rounded-full pl-1 pr-4 py-1 shadow w-fit">
                    {charAvatar?.startsWith('http') || charAvatar?.startsWith('data:') ? (
                        <img src={charAvatar} alt={charName} className="w-7 h-7 rounded-full object-cover border-2 border-[#FFE4D5]" />
                    ) : (
                        <div className="w-7 h-7 rounded-full bg-[#FFE4D5] flex items-center justify-center text-sm">{charAvatar || '🌸'}</div>
                    )}
                    <span className="text-white text-xs font-bold tracking-wider">{charName}</span>
                </div>
            </div>

            {/* Chibi 区——独占 60% 高度，user chibi 摇摆挪进 */}
            <div className="flex-1 flex items-end justify-center gap-3 px-4 pb-2 min-h-0 relative">
                <img
                    src={charChibi}
                    alt="char"
                    className="max-h-full max-w-[42%] object-contain object-bottom drop-shadow-[0_8px_20px_rgba(199,97,130,0.3)]"
                />
                <img
                    src={userChibi}
                    alt="user"
                    className="max-h-full max-w-[42%] object-contain object-bottom drop-shadow-[0_8px_20px_rgba(199,97,130,0.3)]"
                    style={{
                        animation: 'userChibiWaddle 1.6s cubic-bezier(0.34, 1.56, 0.64, 1) both',
                        transformOrigin: 'bottom center',
                    }}
                />
                <style>{`
                    @keyframes userChibiWaddle {
                        0%   { transform: translateX(160%) rotate(0deg); opacity: 0; }
                        20%  { transform: translateX(120%) rotate(-6deg); opacity: 1; }
                        35%  { transform: translateX(80%) rotate(6deg); }
                        50%  { transform: translateX(45%) rotate(-5deg); }
                        65%  { transform: translateX(18%) rotate(4deg); }
                        80%  { transform: translateX(0) rotate(-3deg); }
                        90%  { transform: translateX(0) rotate(2deg); }
                        100% { transform: translateX(0) rotate(0); }
                    }
                `}</style>
            </div>

            {/* 对白盒——独立占下方，绝对不遮 chibi */}
            <div className="px-3 pb-3 pt-2 shrink-0">
                <DialogueBox
                    charName={charName}
                    onAdvance={advance}
                    showArrow={true}
                    arrowGlyph={isLast ? '✓' : '▽'}
                    pageInfo={`${idx + 1} / ${lines.length}`}
                    minHeight={140}
                >
                    <div key={idx} className="text-[#5C3A4A] text-[14px] leading-[1.95] pt-2 whitespace-pre-wrap animate-fade-in">
                        {lines[idx]}
                    </div>
                </DialogueBox>
            </div>
        </div>
    );
};

// ============================================================
// 结局画面（黑屏 → 合照 → 标题 → TRUE HAPPY END → description）
// ============================================================

const EndingScreen: React.FC<{
    title: string;
    description: string;
    charChibi: string;
    userChibi: string;
    onNext: () => void;
}> = ({ title, description, charChibi, userChibi, onNext }) => {
    const [step, setStep] = useState(0);

    useEffect(() => {
        const seq = [600, 1400, 1100, 1600, 1300];
        if (step >= seq.length) return;
        const t = setTimeout(() => setStep(s => s + 1), seq[step]);
        return () => clearTimeout(t);
    }, [step]);

    return (
        <div className="absolute inset-0 bg-black flex flex-col items-center justify-center px-6">
            {step >= 1 && (
                <div className="flex items-end justify-center gap-2 mb-8 animate-fade-in">
                    <img src={charChibi} alt="char" className="h-40 object-contain" />
                    <img src={userChibi} alt="user" className="h-40 object-contain" />
                </div>
            )}
            {step >= 2 && (
                <div className="text-white/85 text-base tracking-wider mb-3 animate-fade-in text-center">
                    {title}
                </div>
            )}
            {step >= 3 && (
                <div className="text-white text-2xl tracking-[6px] font-light mt-2 mb-6 animate-fade-in">
                    TRUE HAPPY END
                </div>
            )}
            {step >= 4 && (
                <div className="text-white/65 text-sm leading-relaxed mt-4 px-4 text-center animate-fade-in whitespace-pre-wrap">
                    {description}
                </div>
            )}
            {step >= 5 && (
                <button
                    onClick={onNext}
                    className="mt-10 px-8 py-2.5 rounded-full bg-white/15 backdrop-blur text-white text-sm tracking-widest border border-white/30 active:scale-95 transition-transform animate-fade-in"
                >
                    继 续
                </button>
            )}
        </div>
    );
};

// ============================================================
// 信
// ============================================================

const LetterView: React.FC<{ text: string; onNext: () => void; charName: string }> = ({ text, onNext, charName }) => (
    <div className="flex flex-col items-center min-h-full px-6 py-10 max-w-md mx-auto overflow-y-auto">
        <div className="text-[10px] tracking-[6px] text-[#C76182] mb-4">从 {charName} 的信</div>
        <div
            className="w-full bg-[#FFF8F1] rounded-2xl px-7 py-8 shadow-lg text-[#5C3A4A] text-[15px] leading-[2.05] whitespace-pre-wrap"
            style={{
                fontFamily: '"Hiragino Sans GB", "PingFang SC", "Microsoft YaHei", sans-serif',
                backgroundImage: 'repeating-linear-gradient(transparent, transparent 31px, rgba(199, 97, 130, 0.05) 31px, rgba(199, 97, 130, 0.05) 32px)',
                boxShadow: '0 12px 32px rgba(199, 97, 130, 0.15), inset 0 0 0 1px rgba(212, 165, 116, 0.2)',
            }}
        >
            {text}
        </div>
        <button
            onClick={onNext}
            className="mt-8 px-8 py-3 rounded-full bg-gradient-to-r from-[#FFB6C8] to-[#F18AAA] text-white font-bold shadow-lg active:scale-95 transition-transform"
        >
            收下 ♥
        </button>
    </div>
);

// ============================================================
// 拼图（char chibi + user chibi 并列在背景上）
// ============================================================

const PuzzleView: React.FC<{
    charChibi: string;
    userChibi: string;
    title: string;
    onDone: () => void;
}> = ({ charChibi, userChibi, title, onDone }) => (
    <div className="flex flex-col items-center min-h-full px-6 py-8 max-w-md mx-auto">
        <div className="text-[#C76182] text-sm tracking-widest mb-1">♥ 拼图卡片 ♥</div>
        <div className="text-[10px] text-[#9D7585] mb-5">{title}</div>
        <div
            className="w-full aspect-[4/5] rounded-3xl relative overflow-hidden flex items-end justify-center"
            style={{
                background: 'linear-gradient(180deg, #FFE8DC 0%, #FFD3DC 60%, #FFBFCB 100%)',
                boxShadow: '0 12px 32px rgba(199, 97, 130, 0.18), inset 0 0 0 2px rgba(255,255,255,0.6)',
            }}
        >
            <div className="absolute inset-0 flex items-center justify-center text-[10px] tracking-[8px] text-white/40">
                BG · TO BE DRAWN
            </div>
            <div className="relative flex items-end justify-center gap-2 pb-8 px-4">
                <img src={charChibi} alt="char chibi" className="h-44 object-contain drop-shadow-md" />
                <img src={userChibi} alt="user chibi" className="h-44 object-contain drop-shadow-md" />
            </div>
        </div>
        <div className="text-[#5C3A4A] text-sm italic mt-5 text-center">「这很像我们耶。」</div>
        <button
            onClick={onDone}
            className="mt-8 px-8 py-3 rounded-full bg-gradient-to-r from-[#FFB6C8] to-[#F18AAA] text-white font-bold shadow-lg active:scale-95 transition-transform"
        >
            完成 ♥
        </button>
    </div>
);

// ============================================================
// Loading 视图
// ============================================================

const LoadingView: React.FC<{ hint?: string }> = ({ hint }) => (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-12 max-w-md mx-auto">
        <div className="text-2xl mb-4 animate-pulse">♥</div>
        <div className="text-[#9D7585] text-xs tracking-widest">{hint ?? '正在准备这个下午…'}</div>
    </div>
);

// ============================================================
// Like520Session — 主状态机
// ============================================================

interface SessionProps {
    charId: string;
    onClose: () => void;
}

export const Like520Session: React.FC<SessionProps> = ({ charId, onClose }) => {
    const { characters, userProfile, apiConfig, updateCharacter, addToast } = useOS();
    const char = characters.find(c => c.id === charId);

    const [phase, setPhase] = useState<Phase>('intro');
    const [errorMsg, setErrorMsg] = useState<string>('');

    const [charChibi, setCharChibi] = useState<ChibiResult | null>(null);
    const [userChibi, setUserChibi] = useState<ChibiResult | null>(null);
    const [callA, setCallA] = useState<Like520CallAResult | null>(null);
    const [callB, setCallB] = useState<Like520CallBResult | null>(null);
    const [chosenTucao, setChosenTucao] = useState<Like520TucaoKey | null>(null);

    // 启动 Call A：char 捏脸开始时
    const callAStartedRef = useRef(false);
    const callBStartedRef = useRef(false);

    const startCallA = useCallback(async () => {
        if (callAStartedRef.current || !char || !apiConfig) return;
        callAStartedRef.current = true;
        try {
            const recent = await DB.getMessagesByCharId(char.id);
            const result = await runLike520CallA(char, userProfile, apiConfig, recent || []);
            setCallA(result);
        } catch (err: any) {
            console.error('[520] Call A failed:', err);
            setErrorMsg(`生成剧本失败：${err?.message || '请重试'}`);
            setPhase('error');
        }
    }, [char, userProfile, apiConfig]);

    const startCallB = useCallback((aResult: Like520CallAResult, tucao: Like520TucaoKey) => {
        if (callBStartedRef.current || !char || !apiConfig) return;
        callBStartedRef.current = true;
        runLike520CallB(char, userProfile, apiConfig, aResult, tucao).then(r => {
            setCallB(r);
        }).catch(err => {
            console.error('[520] Call B failed:', err);
            // 兜底：让用户在 wake_up/letter 阶段看到降级文案
            setCallB({
                wake_up: ['……我们好像一起做了一个梦呀。', '不过，不是坏的那种。'],
                letter: '（信生成出了点小问题。这是一段属于你的、未完成的话——但它一直在。）',
            });
        });
    }, [char, userProfile, apiConfig]);

    // === Phase 导航 ===

    const handleCharChibiConfirm = useCallback((r: ChibiResult) => {
        setCharChibi(r);
        // 等 Call A 结果决定下一步
        if (callA) setPhase('yangcheng');
        else setPhase('loading_a');
    }, [callA]);

    const handleUserChibiConfirm = useCallback((r: ChibiResult) => {
        setUserChibi(r);
        setPhase('uncovered_line');
    }, []);

    // 当 callA 在 loading_a 阶段返回时，自动推进到 yangcheng
    useEffect(() => {
        if (phase === 'loading_a' && callA) {
            setPhase('yangcheng');
        }
    }, [phase, callA]);

    // 当用户选了吐槽 → 开始 Call B
    useEffect(() => {
        if (callA && chosenTucao && !callBStartedRef.current) {
            startCallB(callA, chosenTucao);
        }
    }, [callA, chosenTucao, startCallB]);

    // loading_b 阶段，Call B 一就绪自动推进
    useEffect(() => {
        if (phase === 'loading_b' && callB) {
            setPhase('wake_up');
        }
    }, [phase, callB]);

    // === 保存结果到 char.specialMomentRecords ===
    const saveRecord = useCallback(async () => {
        if (!char || !callA || !callB || !charChibi || !userChibi || !chosenTucao) return;
        const previousRecords = char.specialMomentRecords || {};
        const record: SpecialMomentRecord = {
            content: callB.letter,
            image: charChibi.frameDataUrl,
            timestamp: Date.now(),
            source: 'generated',
            customData: {
                callA,
                callB,
                chosenTucao,
                charChibi: { dataUrl: charChibi.transparentDataUrl, state: charChibi.state },
                userChibi: { dataUrl: userChibi.transparentDataUrl, state: userChibi.state },
            },
        };
        updateCharacter(char.id, {
            specialMomentRecords: { ...previousRecords, [LIKE520_RECORD_KEY]: record },
        });
        try {
            localStorage.setItem(LIKE520_COMPLETED_KEY, '1');
        } catch { /* ignore */ }
        // 写一条 chat 消息留痕
        try {
            await DB.saveMessage({
                charId: char.id,
                role: 'assistant',
                type: 'text',
                content: callB.letter,
                timestamp: Date.now(),
                metadata: { source: 'like520_event', like520Event: true },
            });
        } catch (e) {
            console.warn('[520] save chat message failed', e);
        }
    }, [char, callA, callB, charChibi, userChibi, chosenTucao, updateCharacter]);

    // === 错误页 ===
    if (!char) {
        return (
            <div className="fixed inset-0 z-[9997] flex items-center justify-center bg-[#FFF1E6]">
                <div className="text-[#9D7585]">角色不存在</div>
            </div>
        );
    }

    if (phase === 'error') {
        return (
            <div className="fixed inset-0 z-[9997] flex flex-col items-center justify-center bg-[#FFF1E6] px-8">
                <div className="text-[#C76182] mb-3">⚠</div>
                <div className="text-[#5C3A4A] text-sm text-center mb-6">{errorMsg}</div>
                <button onClick={onClose} className="px-7 py-2.5 rounded-full bg-white text-[#C76182] text-sm font-bold border border-[#FFB6C8] active:scale-95 transition-transform">
                    关闭
                </button>
            </div>
        );
    }

    // === Phase 渲染 ===
    const background = 'linear-gradient(180deg, #FFF1E6 0%, #FFE4EC 100%)';

    return (
        <div className="fixed inset-0 z-[9997] overflow-y-auto" style={{ background }}>
            {phase === 'intro' && (
                <div className="flex flex-col items-center justify-center min-h-full px-8 py-16 max-w-md mx-auto">
                    <div className="text-[10px] tracking-[8px] text-[#C76182] mb-3">5 · 2 · 0</div>
                    <div className="text-[#C76182] text-xl font-bold mb-1 tracking-widest">特别活动</div>
                    <div className="text-[#5C3A4A] text-lg leading-relaxed text-center my-8">
                        如果<span className="mx-1 text-[#C76182]">{char.name}</span>变得小小的，<br />
                        那ta会是——？
                    </div>
                    <button
                        onClick={() => { startCallA(); setPhase('char_creator'); }}
                        className="mt-6 px-10 py-3 rounded-full bg-gradient-to-r from-[#FFB6C8] to-[#F18AAA] text-white font-bold shadow-lg active:scale-95 transition-transform"
                    >
                        开始装扮 ♥
                    </button>
                    <button
                        onClick={onClose}
                        className="mt-4 text-xs text-[#9D7585]"
                    >
                        以后再说
                    </button>
                </div>
            )}

            {phase === 'char_creator' && (
                <div className="absolute inset-0">
                    <CreatorIframe
                        mode="char"
                        charName={char.name}
                        presets={isSullyChar(char) ? sullyPresets() : undefined}
                        onConfirm={handleCharChibiConfirm}
                    />
                </div>
            )}

            {phase === 'loading_a' && <LoadingView hint="ta 在准备这个下午…" />}

            {phase === 'yangcheng' && callA && charChibi && (
                <Y520Scene
                    callA={callA}
                    charName={char.name}
                    charAvatar={char.avatar}
                    charChibiUrl={charChibi.transparentDataUrl}
                    onTucaoSelected={(k) => setChosenTucao(k)}
                    onComplete={() => setPhase('user_creator')}
                />
            )}

            {phase === 'user_creator' && (
                <div className="absolute inset-0">
                    <CreatorIframe
                        mode="user"
                        charName={char.name}
                        onConfirm={handleUserChibiConfirm}
                    />
                </div>
            )}

            {phase === 'uncovered_line' && callA && charChibi && userChibi && (
                <UncoveredLineView
                    lines={callA.uncovered_line}
                    charName={char.name}
                    charAvatar={char.avatar}
                    charChibi={charChibi.transparentDataUrl}
                    userChibi={userChibi.transparentDataUrl}
                    onComplete={() => setPhase('ending_screen')}
                />
            )}

            {phase === 'ending_screen' && callA && charChibi && userChibi && (
                <EndingScreen
                    title={callA.ending.title}
                    description={callA.ending.description}
                    charChibi={charChibi.transparentDataUrl}
                    userChibi={userChibi.transparentDataUrl}
                    onNext={() => {
                        if (callB) setPhase('wake_up');
                        else setPhase('loading_b');
                    }}
                />
            )}

            {phase === 'loading_b' && <LoadingView hint="醒过来之前…" />}

            {phase === 'wake_up' && callB && (
                <LineQueueView
                    lines={callB.wake_up}
                    charName={char.name}
                    onComplete={() => setPhase('letter')}
                />
            )}

            {phase === 'letter' && callB && (
                <LetterView
                    text={callB.letter}
                    charName={char.name}
                    onNext={() => {
                        saveRecord();
                        setPhase('puzzle');
                    }}
                />
            )}

            {phase === 'puzzle' && callA && charChibi && userChibi && (
                <PuzzleView
                    charChibi={charChibi.transparentDataUrl}
                    userChibi={userChibi.transparentDataUrl}
                    title={callA.ending.title}
                    onDone={() => setPhase('done')}
                />
            )}

            {phase === 'done' && (
                <div className="flex flex-col items-center justify-center min-h-full px-8 py-12 max-w-md mx-auto">
                    <div className="text-2xl mb-3">♥</div>
                    <div className="text-[#5C3A4A] text-base mb-1">这个下午存好了。</div>
                    <div className="text-[10px] tracking-widest text-[#9D7585] mb-8">TRUE HAPPY END</div>
                    <button
                        onClick={onClose}
                        className="px-10 py-3 rounded-full bg-gradient-to-r from-[#FFB6C8] to-[#F18AAA] text-white font-bold shadow-lg active:scale-95 transition-transform"
                    >
                        关闭
                    </button>
                </div>
            )}
        </div>
    );
};

// ============================================================
// Controller — 弹窗 → 角色选择 → Session
// ============================================================

interface Like520ControllerProps {
    onClose: () => void;
    initialCharId?: string;
}

export const Like520Controller: React.FC<Like520ControllerProps> = ({ onClose, initialCharId }) => {
    const { characters } = useOS();
    const [stage, setStage] = useState<'popup' | 'select' | 'session'>(initialCharId ? 'session' : 'popup');
    const [charId, setCharId] = useState<string>(initialCharId || '');

    const dismiss = () => {
        try { localStorage.setItem(LIKE520_DISMISSED_KEY, '1'); } catch { /* ignore */ }
        onClose();
    };

    if (stage === 'popup') {
        return (
            <div className="fixed inset-0 z-[9998] flex items-center justify-center p-5 animate-fade-in">
                <div className="absolute inset-0 bg-black/40 backdrop-blur" onClick={dismiss} />
                <div className="relative w-full max-w-sm bg-gradient-to-br from-[#FFF8F1] to-[#FFE4EC] rounded-[2rem] shadow-2xl border border-white/40 overflow-hidden animate-slide-up">
                    <div className="px-6 pt-8 pb-3 text-center">
                        <div className="text-[10px] tracking-[8px] text-[#C76182] mb-2">5 · 2 · 0</div>
                        <h3 className="text-xl font-bold text-[#5C3A4A] mb-1">特别活动</h3>
                        <p className="text-[12px] text-[#9D7585] leading-relaxed mt-3">
                            ta 突然变得小小的——<br/>
                            要不要去看看？
                        </p>
                    </div>
                    <div className="px-6 pb-6 pt-3 flex flex-col gap-2">
                        <button onClick={() => setStage('select')} className="w-full py-3 rounded-2xl font-bold text-white shadow-lg bg-gradient-to-r from-[#FFB6C8] to-[#F18AAA] active:scale-95 transition-transform">
                            进入活动 ♥
                        </button>
                        <button onClick={dismiss} className="w-full py-2.5 text-[#9D7585] text-sm">
                            以后再说
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (stage === 'select') {
        return (
            <div className="fixed inset-0 z-[9998] flex items-center justify-center p-5 animate-fade-in">
                <div className="absolute inset-0 bg-black/40 backdrop-blur" onClick={onClose} />
                <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2rem] shadow-2xl border border-white/40 overflow-hidden max-h-[80vh] flex flex-col">
                    <div className="px-6 pt-6 pb-3 text-center shrink-0">
                        <h3 className="text-lg font-bold text-[#5C3A4A]">选一个 ta</h3>
                        <p className="text-[11px] text-[#9D7585] mt-1">一起度过这个下午</p>
                    </div>
                    <div className="px-4 pb-4 overflow-y-auto flex-1">
                        {characters.length === 0 ? (
                            <div className="text-center text-sm text-[#9D7585] py-8">还没有角色呢</div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                {characters.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => { setCharId(c.id); setStage('session'); }}
                                        className="flex flex-col items-center gap-2 p-3 bg-[#FFF8F1] rounded-2xl border border-[#FCEDD9] active:scale-95 transition-transform"
                                    >
                                        {c.avatar?.startsWith('http') || c.avatar?.startsWith('data:') ? (
                                            <img src={c.avatar} alt={c.name} className="w-12 h-12 rounded-full object-cover" />
                                        ) : (
                                            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-2xl">
                                                {c.avatar || '🌸'}
                                            </div>
                                        )}
                                        <div className="text-[12px] font-bold text-[#5C3A4A] truncate w-full">{c.name}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[9998]">
            <Like520Session charId={charId} onClose={onClose} />
        </div>
    );
};
