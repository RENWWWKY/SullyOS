import { describe, it, expect } from 'vitest';
import { sanitizeForBubble, sanitizeForNotification } from './sanitize';

// ─── Oracle: 原版 chatParser.sanitize (来自 commit e97f9ed) ─────────────────
// 用来跟 sanitizeForBubble 字节对齐校验. refactor 后改 sanitize.ts 就立刻能
// 看到行为漂移.
function originalSanitize(text: string, options?: { keepCitations?: boolean }): string {
  let result = text
    .replace(/\\n/g, '\n')
    .replace(/\s*\[(?:聊天|通话|约会)\]\s*/g, '\n')
    .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/g, '')
    .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*/gm, '')
    .replace(/（[上下]午\d{1,2}[：:]\d{2}）/g, '')
    .replace(/\(\d{1,2}:\d{2}\s*[AP]M\)/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[\[(?:ACTION|RECALL|SEARCH|DIARY|READ_DIARY|FS_DIARY|FS_READ_DIARY|DIARY_START|DIARY_END|FS_DIARY_START|FS_DIARY_END|MUSIC_ACTION)[:\s][\s\S]*?\]\]/g, '')
    .replace(/\[schedule_message[^\]]*\]/g, '');
  if (!options?.keepCitations) {
    result = result
      .replace(/\[\[(?:QU[OA]TE|引用)[：:][\s\S]*?\]\]/g, '')
      .replace(/\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g, '')
      .replace(/\[回复\s*[""“][^""”]*?[""”](?:\.{0,3})\]\s*[：:]?\s*/g, '');
  }
  return result
    .replace(/`(\[\[[\s\S]*?\]\])`/g, '$1')
    .replace(/``+/g, '')
    .replace(/(^|\s)`(\s|$)/gm, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*{2,}/g, '')
    .replace(/^\s*---\s*$/gm, '')
    .replace(/^\s*[-*+]\s*$/gm, '')
    .replace(/%%TRANS%%[\s\S]*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── sanitizeForNotification: 底层 helper 等价类 ───────────────────────────

describe('sanitizeForNotification', () => {
  it('A1 字面 \\n 还原', () => {
    expect(sanitizeForNotification('a\\nb')).toBe('a\nb');
  });

  it('A2 源标签 → 换行 (replace-with-marker)', () => {
    expect(sanitizeForNotification('你好[聊天]在吗')).toBe('你好\n在吗');
  });

  it('A3 时间戳 4 变体一次过', () => {
    // 注意: English 12h `\(...\)` 不吃 trailing 空格 (跟原版正则保持一致),
    // 所以 `(1:52 PM) hi4` 剥后是 ' hi4'.
    const input = '[2026-05-20 13:52] hi\n2026-05-20 13:52 hi2\n（下午1:52）hi3\n(1:52 PM) hi4';
    expect(sanitizeForNotification(input)).toBe('hi\nhi2\nhi3\n hi4');
  });

  it('A4 业务标签 alternation 全剥', () => {
    const input = 'a[[ACTION:POKE]]b[[RECALL: 2024-05]]c[schedule_message|t1|fixed|x]d';
    expect(sanitizeForNotification(input)).toBe('abcd');
  });

  it('A5 引用三变体 (keepCitations=false)', () => {
    expect(sanitizeForNotification('[[QUOTE：x]]a[QUOTE：y]b[回复 "z"]: c'))
      .toBe('abc');
  });

  it('A6 backtick 三变体', () => {
    expect(sanitizeForNotification('a `[[X:1]]` b `` c ` d'))
      .toBe('a [[X:1]] b  c  d');
  });

  it('A7 markdown link → [链接：text]', () => {
    expect(sanitizeForNotification('see [click](https://x.com) here'))
      .toBe('see [链接：click] here');
  });

  it('A9 <think> 闭合 + 未闭合兜底', () => {
    expect(sanitizeForNotification('a<think>x</think>b<thinking>tail'))
      .toBe('ab');
  });

  it('A10 SEND_EMOJI 正向 + 反向 emoji tag', () => {
    expect(sanitizeForNotification('[Sully 发送了表情包: 笑] 然后 [[SEND_EMOJI: 哭]]'))
      .toBe('[表情：笑] 然后 [表情：哭]');
  });

  it('A11 [html] 块屏蔽内部 markdown', () => {
    expect(sanitizeForNotification('前 [html]# h1 **bold**[/html] 后'))
      .toBe('前 [HTML 卡片] 后');
  });

  it('A12 <翻译> 保留原文剥译文', () => {
    expect(sanitizeForNotification('<翻译><原文>Hi</原文><译文>嗨</译文></翻译>'))
      .toBe('Hi');
  });

  // ─── 顺序依赖 (interaction bugs) ─────────────────────────────────────────

  it('B1 markdown link 在 header strip 之前 (不吃 # frag)', () => {
    expect(sanitizeForNotification('[click](https://x.com/#frag)'))
      .toBe('[链接：click]');
  });

  it('B2 [html] 在 markdown 之前 (内部 # 不被剥)', () => {
    expect(sanitizeForNotification('[html]# h1\n**b**\n[/html]'))
      .toBe('[HTML 卡片]');
  });

  it('B3 <think> 在 INNER_STATE / 业务标签之前 (一次吃光)', () => {
    expect(sanitizeForNotification('<think>[[INNER_STATE: x]][[ACTION:POKE]]</think>real'))
      .toBe('real');
  });

  it('B4 字面 \\n 还原在 line-anchored 之前', () => {
    // 字面 `\n` 还原后, ^锚定的 timestamp 才能命中
    expect(sanitizeForNotification('foo\\n2026-05-20 13:52 hi'))
      .toBe('foo\nhi');
  });

  // ─── 边界 ──────────────────────────────────────────────────────────────

  it('C1 空串', () => {
    expect(sanitizeForNotification('')).toBe('');
  });

  it('C2 全空白', () => {
    expect(sanitizeForNotification('\n\n\n   ')).toBe('');
  });

  it('C3 幂等 (关键不变量)', () => {
    const cases = [
      '<think>x</think>real',
      '[html]内容[/html]',
      '<翻译><原文>A</原文><译文>B</译文></翻译>',
      'a[[ACTION:POKE]]b[[SEND_EMOJI: 笑]]c',
      '[click](https://example.com/#anchor)',
    ];
    for (const x of cases) {
      const once = sanitizeForNotification(x);
      const twice = sanitizeForNotification(once);
      expect(twice).toBe(once);
    }
  });

  // ─── notification 路径独有: READ_NOTE / XHS_* 剥 ───────────────────────

  it('notification 路径额外剥 READ_NOTE / XHS_*', () => {
    expect(sanitizeForNotification('a[[READ_NOTE: key]]b[[XHS_LIKE: 1]]c[[XHS_MY_PROFILE]]d'))
      .toBe('abcd');
  });
});

// ─── sanitizeForBubble: byte-aligned to original chatParser.sanitize ──────

describe('sanitizeForBubble byte-alignment (C4 oracle)', () => {
  const fixtures: Array<{ name: string; input: string; opts?: { keepCitations?: boolean } }> = [
    { name: 'plain text', input: '你好世界' },
    { name: 'business tags', input: 'a[[ACTION:POKE]]b' },
    { name: 'timestamp leak', input: '[2026-05-20 13:52] hi' },
    { name: 'source tag', input: '你好[聊天]在吗' },
    { name: 'backtick wrap', input: 'a `[[X:1]]` b' },
    { name: 'markdown link', input: 'see [click](https://x.com)' },
    { name: 'markdown header', input: '# title\nbody' },
    { name: 'literal newline', input: 'a\\nb' },
    { name: 'bold markers', input: '**hi** **bye**' },
    { name: 'quote keepCitations=false', input: '[[QUOTE：x]] hi', opts: { keepCitations: false } },
    { name: 'quote keepCitations=true', input: '[[QUOTE：x]] hi', opts: { keepCitations: true } },
    { name: '回复 reply quote', input: '[回复 "原话"]: 嗯' },
    { name: 'empty', input: '' },
    { name: 'whitespace only', input: '\n\n\n' },
    { name: 'XHS tag (bubble 保留, notification 剥)', input: '[[XHS_LIKE: 1]] hi' },
    { name: 'SEND_EMOJI (bubble 保留)', input: 'hi [[SEND_EMOJI: 笑]]' },
    { name: '<think> (bubble 保留)', input: '<think>x</think>real' },
  ];

  for (const { name, input, opts } of fixtures) {
    it(`oracle: ${name}`, () => {
      expect(sanitizeForBubble(input, opts)).toBe(originalSanitize(input, opts));
    });
  }
});

// ─── sanitizeForBubble 跟 sanitizeForNotification 差异点 ───────────────────

describe('bubble vs notification differences', () => {
  it('A8 bubble 路径: markdown link → text (无 [链接：] 包装)', () => {
    // notification 把 [text](url) → [链接：text]; bubble 保留老行为 → text
    expect(sanitizeForBubble('see [click](https://x.com)')).toBe('see click');
  });

  it('bubble 路径保留 SEND_EMOJI / <think> / INNER_STATE (下游 step 用)', () => {
    expect(sanitizeForBubble('[[SEND_EMOJI: 笑]]'))
      .toBe('[[SEND_EMOJI: 笑]]');
    expect(sanitizeForBubble('<think>x</think>real'))
      .toBe('<think>x</think>real');
    expect(sanitizeForBubble('[[INNER_STATE: x]]real'))
      .toBe('[[INNER_STATE: x]]real');
  });

  it('bubble 路径不剥 XHS_* / READ_NOTE (老行为)', () => {
    expect(sanitizeForBubble('[[XHS_LIKE: 1]] hi')).toBe('[[XHS_LIKE: 1]] hi');
    expect(sanitizeForBubble('[[READ_NOTE: key]] hi')).toBe('[[READ_NOTE: key]] hi');
  });
});
