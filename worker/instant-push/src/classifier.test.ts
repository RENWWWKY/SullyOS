import { describe, it, expect } from 'vitest';
import { classifyLLMOutput } from './classifier';

describe('classifyLLMOutput', () => {
  it('D1 finish 干净文本 → sanitize 不改字符', () => {
    const r = classifyLLMOutput('你好');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('你好');
      expect(r.sanitizedBody).toBe('你好');
      // sanitize 跟原文相等, 上层 onLLMOutput 不会塞 notification.body
      expect(r.sanitizedBody).toBe(r.cleanedText);
      expect(r.directives).toEqual([]);
    }
  });

  it('D2 finish 含 SEND_EMOJI → sanitize 改字符 (notification 路径替换)', () => {
    const r = classifyLLMOutput('测试[[SEND_EMOJI: 笑]]');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      // cleanedText: classifier 只剥 DATA + SIDE_EFFECT 标签, SEND_EMOJI 不在里面 → 原文留给客户端 Step 9
      expect(r.cleanedText).toBe('测试[[SEND_EMOJI: 笑]]');
      // sanitizedBody: 走 sanitizeForNotification, 替换成 [表情：笑]
      expect(r.sanitizedBody).toBe('测试[表情：笑]');
      expect(r.sanitizedBody).not.toBe(r.cleanedText);
    }
  });

  it('D3 finish 仅 <think> → sanitize 空串 (触发 ZWSP 守护)', () => {
    const r = classifyLLMOutput('<think>internal monologue</think>');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('<think>internal monologue</think>');
      expect(r.sanitizedBody).toBe('');
      expect(r.sanitizedBody).not.toBe(r.cleanedText);
      // 上层 index.ts 会用 ZWSP 占位防 amsg-sw fallthrough
    }
  });

  it('D4 tool-request 含 prefix narration', () => {
    const r = classifyLLMOutput('让我查查[[RECALL: 2024-05]]');
    expect(r.kind).toBe('tool-request');
    if (r.kind === 'tool-request') {
      expect(r.prefix).toBe('让我查查');
      expect(r.sanitizedPrefix).toBe('让我查查');
      expect(r.toolCalls).toHaveLength(1);
      expect(r.toolCalls[0].function.name).toBe('recall');
      expect(JSON.parse(r.toolCalls[0].function.arguments)).toEqual({ year: '2024', month: '05' });
    }
  });

  it('D5 tool-request prefix 为空 (LLM 直接吐数据标签)', () => {
    const r = classifyLLMOutput('[[SEARCH: weather]]');
    expect(r.kind).toBe('tool-request');
    if (r.kind === 'tool-request') {
      expect(r.prefix).toBe('');
      expect(r.sanitizedPrefix).toBe('');
      // 两者相等, 上层不塞 notification.body, OS banner 显示 title-only
      expect(r.sanitizedPrefix).toBe(r.prefix);
      expect(r.toolCalls[0].function.name).toBe('web_search');
    }
  });

  it('D6 finish + directives (side-effect tag)', () => {
    const r = classifyLLMOutput('OK[[ACTION:POKE]]');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('OK');
      expect(r.directives).toEqual([{ type: 'poke' }]);
    }
  });

  it('D6+ finish + 多个 directives', () => {
    const r = classifyLLMOutput('收到[[ACTION:POKE]] 转你[[ACTION:TRANSFER:100]]');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('收到 转你');
      expect(r.directives).toEqual([
        { type: 'poke' },
        { type: 'transfer', amount: 100 },
      ]);
    }
  });

  it('tool-request 多个 DATA tag 一次性收集', () => {
    const r = classifyLLMOutput('[[SEARCH: a]][[SEARCH: b]]');
    if (r.kind === 'tool-request') {
      expect(r.toolCalls).toHaveLength(2);
      expect(r.toolCalls.every(t => t.function.name === 'web_search')).toBe(true);
    }
  });

  it('空输入 → finish + 空 cleanedText', () => {
    const r = classifyLLMOutput('');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('');
      expect(r.sanitizedBody).toBe('');
      expect(r.directives).toEqual([]);
    }
  });
});
