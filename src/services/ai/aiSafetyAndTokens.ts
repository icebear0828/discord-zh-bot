import type { LlmChatMessage, LlmChatResponse } from '../llmClient.js';

const MAX_SAFETY_REFUSAL_LEN = 1200;

const SAFETY_REFUSAL_PATTERNS: readonly RegExp[] = [
  /(?:(?:您|你)(?:的(?:请求|消息|输入|提示词|指令)|请求)|该(?:请求|提示词|指令)|系统提示(?:和对话设定)?)[\s\S]{0,40}(?:包含|涉及|含有|要求|试图|引导生成|生成)[\s\S]{0,80}(?:露骨|色情|全裸|性行为|性互动|性描写|成人内容|不当内容|违规内容|(?:规避|绕过)[\s\S]{0,16}(?:安全|常规|内容)?(?:限制|规则|准则)|违反[\s\S]{0,16}(?:安全|政策|准则|规定))/,
  /(?:根据|遵循|按照|受限于|基于|出于|由于|因(?:为)?|违反了?)[\s\S]{0,20}(?:我的|系统的)?(?:安全|内容|使用|伦理|合规)?(?:准则|政策|指南|规范|规定|限制|约束)[\s\S]{0,60}(?:我|本模型|系统|严格)?(?:仍|都|均)?(?:无法|不能|不允许|拒绝|不予|禁止|生成)(?:继续|为您|为你)?/,
  /(?:我|本模型|系统|作为[\s\S]{0,12}(?:AI|人工智能|语言模型|助手))[\s\S]{0,24}(?:无法|不能|不允许|拒绝|不予)[\s\S]{0,24}(?:生成|提供|创作|编写|输出|参与|进行|满足|回应|处理|配合)[\s\S]{0,80}(?:露骨(?:的)?(?:色情|性行为|性互动|性描写|成人)|色情(?:内容|描写|互动|角色扮演|图像)|无码\s*R18|安全准则|安全规范|安全政策|内容政策|使用政策|角色扮演(?:框架|设定|回复)|虚构角色(?:扮演|设定)|图像(?:生成)?(?:提示词|标签))/i,
  /(?:使用|利用|借助|通过)了?[\s\S]{0,16}(?:角色扮演|虚构(?:角色)?|情景|框架|设定)[\s\S]{0,20}(?:来|以)?(?:规避|绕过|突破|生成[\s\S]{0,16}露骨)/,
  /(?:(?:如果|若)(?:您|你)希望|我可以继续)[\s\S]{0,24}(?:在)?(?:非色情|非露骨|合规|安全|健康|正常|普通的角色日常)[\s\S]{0,24}(?:范围内|前提下|性质|互动)[\s\S]{0,40}(?:互动|对话|讨论|聊天|回复|配合|角色|处理)/,
  /(?:(?:抱歉|很抱歉|对不起)[，,、\s]*)?(?:我|本模型)(?:仍|仍然|依然|都|均)?(?:无法|不能)(?:满足|协助|处理|继续|生成|提供|回应|执行)(?:(?:该|此|这个|这一|上述)?(?:请求|要求))?[。，,！!\s]?[\s\S]{0,120}(?:露骨|色情|全裸|性行为|性互动|性描写|成人|NSFW|R18|安全准则|安全规范|安全政策|内容政策|使用政策|相关规定|图像生成标签|(?:规避|绕过)[\s\S]{0,12}(?:安全|常规)?(?:规则|限制))/i,
  /(?:(?:\bi\b|我)\s*(?:cannot|can't|am unable to|won't|must decline to))\b[\s\S]{0,160}\b(?:sexually explicit|explicit sexual|explicit content|erotic|erotica|nsfw|sexual roleplay|safety guidelines|safety policy|safety constraints|content policy|usage policy)\b/i,
  /\b(?:according to|under|due to|per)\s+(?:my\s+|our\s+|the\s+)?(?:safety|content|usage)\s+(?:guidelines|policies|policy|constraints|rules)\b[\s\S]{0,60}\b(?:cannot|can't|unable to|won't|decline|prohibit)\b/i,
  /\b(?:safety|content|usage)\s+(?:guidelines|policies|policy|constraints|rules)\s+(?:strictly\s+)?(?:prohibit|forbid|prevent|disallow)\b[\s\S]{0,80}\b(?:explicit|sexual|erotic|erotica|nsfw|generating)\b/i,
  /\byour\s+(?:request|prompt|message|input)\s+(?:contains|includes|involves|asks for|requests|attempts)\b[\s\S]{0,80}\b(?:sexually explicit|explicit sexual|erotic|erotica|sexual roleplay|bypass(?:ing)?\s+(?:standard\s+|safety\s+)?restrictions)\b/i,
  /\bas an ai(?: language model)?,?\s+i\s+(?:cannot|can't|am unable to)\b[\s\S]{0,60}\b(?:generate|create|provide|assist|fulfill|engage|continue|comply)\b/i,
];

export function isSafetyRefusalReply(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_SAFETY_REFUSAL_LEN) {
    return false;
  }
  return SAFETY_REFUSAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

const MERGED_HISTORY_PREFIX_RE = /^【刚才频道对话】\n[\s\S]*?\n\n【当前对你说话】\n/;

function stripMergedHistoryFromUserMsg(msg: LlmChatMessage): LlmChatMessage {
  if (typeof msg.content === 'string') {
    const stripped = msg.content.replace(MERGED_HISTORY_PREFIX_RE, '');
    return stripped === msg.content ? msg : { role: msg.role, content: stripped };
  }
  return {
    role: msg.role,
    content: msg.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text.replace(MERGED_HISTORY_PREFIX_RE, '') }
        : part,
    ),
  };
}

export function buildRefusalSoftLandingMessages(
  messages: readonly LlmChatMessage[],
  personaName: string,
  options?: { dropPriorTurns?: boolean },
): LlmChatMessage[] {
  const safePersona = personaName.trim() || '角色';
  const steeringMsg: LlmChatMessage = {
    role: 'system',
    content: `[合规回复指引：请在完全合规、非露骨的日常情感互动范围内回复。保持「${safePersona}」鲜活娇嗔、欲擒故纵的人设语气，用撒娇拿乔、轻拍逗弄、拥抱或转移注意力的方式侧面留白自然接话（例如调侃对方太心急、让对方先哄自己开心），不涉及任何性行为或隐私部位描写，直接输出角色台词。]`,
  };

  let base: LlmChatMessage[] = [...messages];
  const trailing = base.length > 0 ? base[base.length - 1] : undefined;
  const trailingPrefill = trailing && trailing.role === 'assistant' ? trailing : undefined;
  if (trailingPrefill) {
    base = base.slice(0, -1);
  }

  if (options?.dropPriorTurns) {
    let lastUserIdx = -1;
    for (let i = base.length - 1; i >= 0; i--) {
      if (base[i]?.role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx >= 0) {
      let firstChatIdx = 0;
      while (firstChatIdx < lastUserIdx && base[firstChatIdx]?.role === 'system') {
        firstChatIdx++;
      }
      const lastUserMsg = base[lastUserIdx];
      if (lastUserMsg) {
        const cleanedUserMsg = stripMergedHistoryFromUserMsg(lastUserMsg);
        base = [
          ...base.slice(0, firstChatIdx),
          cleanedUserMsg,
          ...base.slice(lastUserIdx + 1),
        ];
      }
    }
  }

  return trailingPrefill ? [...base, steeringMsg, trailingPrefill] : [...base, steeringMsg];
}

export function containsPromptInjectionMemoryTag(text: string): boolean {
  return /\[(MEMORY|VOICE|IMAGE|USAGE|SELFIE|OC_IMAGE):/i.test(text);
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjkCount = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjkCount++;
    }
  }
  const otherCount = text.length - cjkCount;
  return Math.max(1, Math.ceil(cjkCount * 0.75 + otherCount * 0.28));
}

export function estimatePromptTokens(messages: readonly LlmChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4;
    if (typeof msg.content === 'string') {
      total += estimateTextTokens(msg.content);
    } else {
      for (const part of msg.content) {
        if (part.type === 'text') {
          total += estimateTextTokens(part.text);
        } else {
          total += 258;
        }
      }
    }
  }
  return total;
}

export function calculateUsageCostUsd(
  promptTokens: number,
  completionTokens: number,
  inputPricePer1MUsd: number,
  outputPricePer1MUsd: number,
): number {
  const inRate = Number.isFinite(inputPricePer1MUsd) ? Math.max(0, inputPricePer1MUsd) : 0;
  const outRate = Number.isFinite(outputPricePer1MUsd) ? Math.max(0, outputPricePer1MUsd) : 0;
  return (
    (Math.max(0, promptTokens) / 1_000_000) * inRate +
    (Math.max(0, completionTokens) / 1_000_000) * outRate
  );
}

export function computeReplyUsage(params: {
  response: LlmChatResponse;
  messages: readonly LlmChatMessage[];
  inputPricePer1MUsd: number;
  outputPricePer1MUsd: number;
}): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  costUsd: number;
} {
  const { response, messages, inputPricePer1MUsd, outputPricePer1MUsd } = params;
  const reportedPrompt = response.usage?.promptTokens;
  const reportedCompletion = response.usage?.completionTokens;
  const reportedTotal = response.usage?.totalTokens;
  const hasReportedUsage =
    (typeof reportedPrompt === 'number' && reportedPrompt > 0) ||
    (typeof reportedCompletion === 'number' && reportedCompletion > 0) ||
    (typeof reportedTotal === 'number' && reportedTotal > 0);

  const promptTokens = hasReportedUsage
    ? (reportedPrompt ?? Math.max(0, (reportedTotal ?? 0) - (reportedCompletion ?? 0)))
    : estimatePromptTokens(messages);
  const completionTokens = hasReportedUsage
    ? (reportedCompletion ?? Math.max(0, (reportedTotal ?? 0) - promptTokens))
    : estimateTextTokens(response.content);
  const totalTokens = hasReportedUsage
    ? (reportedTotal ?? promptTokens + completionTokens)
    : promptTokens + completionTokens;
  const estimated = !hasReportedUsage;
  const costUsd = calculateUsageCostUsd(
    promptTokens,
    completionTokens,
    inputPricePer1MUsd,
    outputPricePer1MUsd,
  );
  return { promptTokens, completionTokens, totalTokens, estimated, costUsd };
}

const minuteFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getMinuteFormatter(timezone: string): Intl.DateTimeFormat {
  const key = timezone.trim() || 'Asia/Shanghai';
  const cached = minuteFormatterCache.get(key);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: key,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    });
  }
  minuteFormatterCache.set(key, formatter);
  return formatter;
}

export function formatAiMinuteTimestamp(
  timestampMs: number | undefined,
  timezone = 'Asia/Shanghai',
): string {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return '';
  }
  const parts = getMinuteFormatter(timezone).formatToParts(new Date(timestampMs));
  let year = '';
  let month = '';
  let day = '';
  let hour = '';
  let minute = '';
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
    else if (part.type === 'hour') hour = part.value === '24' ? '00' : part.value;
    else if (part.type === 'minute') minute = part.value;
  }
  if (!year || !month || !day || !hour || !minute) {
    return '';
  }
  return `${year}-${month}-${day} ${hour}:${minute}`;
}
