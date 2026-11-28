export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function extractUsage(rawUsage: unknown): LlmUsage | undefined {
  if (!isRecord(rawUsage)) return undefined;

  const promptTokens =
    readNonNegativeInt(rawUsage.prompt_tokens) ?? readNonNegativeInt(rawUsage.input_tokens);
  const rawCompletionTokens =
    readNonNegativeInt(rawUsage.completion_tokens) ?? readNonNegativeInt(rawUsage.output_tokens);
  const rawTotalTokens = readNonNegativeInt(rawUsage.total_tokens);

  const compDetails = isRecord(rawUsage.completion_tokens_details)
    ? rawUsage.completion_tokens_details
    : isRecord(rawUsage.output_tokens_details)
      ? rawUsage.output_tokens_details
      : undefined;
  const explicitReasoning =
    (compDetails ? readNonNegativeInt(compDetails.reasoning_tokens) : undefined) ??
    readNonNegativeInt(rawUsage.thoughts_token_count);

  let completionTokens = rawCompletionTokens;
  let reasoningTokens = explicitReasoning;

  // If an upstream reports visible completion_tokens separately from total_tokens
  // (e.g. total = prompt + visible_completion + thoughts), lift completionTokens
  // so billed thinking tokens are never dropped.
  if (
    promptTokens !== undefined &&
    rawCompletionTokens !== undefined &&
    rawTotalTokens !== undefined &&
    rawTotalTokens > promptTokens + rawCompletionTokens
  ) {
    const inferredReasoning = rawTotalTokens - promptTokens - rawCompletionTokens;
    completionTokens = rawTotalTokens - promptTokens;
    if (reasoningTokens === undefined) {
      reasoningTokens = inferredReasoning;
    }
  }

  const totalTokens =
    rawTotalTokens ??
    (promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(reasoningTokens !== undefined && reasoningTokens > 0 ? { reasoningTokens } : {}),
  };
}

export function mergeLlmUsage(a?: LlmUsage, b?: LlmUsage): LlmUsage | undefined {
  if (!a && !b) return undefined;
  if (!a) return { ...b };
  if (!b) return { ...a };

  const hasPrompt = a.promptTokens !== undefined || b.promptTokens !== undefined;
  const hasCompletion = a.completionTokens !== undefined || b.completionTokens !== undefined;
  const hasTotal = a.totalTokens !== undefined || b.totalTokens !== undefined;
  const hasReasoning = a.reasoningTokens !== undefined || b.reasoningTokens !== undefined;

  const promptTokens = hasPrompt ? (a.promptTokens ?? 0) + (b.promptTokens ?? 0) : undefined;
  const completionTokens = hasCompletion
    ? (a.completionTokens ?? 0) + (b.completionTokens ?? 0)
    : undefined;
  const totalTokens = hasTotal
    ? (a.totalTokens ?? (a.promptTokens ?? 0) + (a.completionTokens ?? 0)) +
      (b.totalTokens ?? (b.promptTokens ?? 0) + (b.completionTokens ?? 0))
    : promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined;
  const reasoningTokens = hasReasoning
    ? (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0)
    : undefined;

  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(reasoningTokens !== undefined && reasoningTokens > 0 ? { reasoningTokens } : {}),
  };
}

export function resolveReturnedModelName(requestedModel: string, upstreamModel?: string): string {
  const reqTrimmed = requestedModel.trim();
  const upTrimmed = upstreamModel?.trim();
  if (!upTrimmed) return reqTrimmed;
  const slashIdx = reqTrimmed.indexOf('/');
  if (slashIdx > 0 && reqTrimmed.slice(slashIdx + 1) === upTrimmed) {
    return reqTrimmed;
  }
  return upTrimmed;
}

export function extractTextFromContentField(rawContent: unknown): string {
  if (typeof rawContent === 'string') {
    return rawContent;
  }
  if (Array.isArray(rawContent)) {
    const texts: string[] = [];
    for (const part of rawContent) {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
        texts.push(part.text);
      }
    }
    return texts.join('');
  }
  return '';
}

export function extractResponseContent(data: unknown): {
  content: string;
  model?: string;
  usage?: LlmUsage;
  finishReason?: string;
} {
  if (!isRecord(data)) {
    return { content: '' };
  }

  const model = typeof data.model === 'string' ? data.model : undefined;
  const usage = extractUsage(data.usage);

  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { content: '', model, usage };
  }

  const first = choices[0];
  if (!isRecord(first)) {
    return { content: '', model, usage };
  }

  const finishReason =
    typeof first.finish_reason === 'string' && first.finish_reason.trim()
      ? first.finish_reason.trim()
      : undefined;

  const msg = first.message;
  if (!isRecord(msg)) {
    return { content: '', model, usage, finishReason };
  }

  const text = extractTextFromContentField(msg.content).trim();
  return { content: text, model, usage, finishReason };
}

export function isContextTooLong(status: number, bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    status === 413 ||
    (status === 400 &&
      (lower.includes('context_length') ||
        lower.includes('maximum context') ||
        lower.includes('too many tokens') ||
        lower.includes('token limit')))
  );
}

export function isUpstreamPoolError(bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    lower.includes('upstream_http_error') ||
    lower.includes('upstream error') ||
    lower.includes('上游 http') ||
    lower.includes('上游错误') ||
    lower.includes('no available account') ||
    lower.includes('account_unavailable') ||
    lower.includes('channel_error')
  );
}

export function isRetryableHttpStatus(status: number, bodyText: string): boolean {
  if (isContextTooLong(status, bodyText)) {
    return false;
  }
  if (status === 429 || status === 408 || status === 409 || status === 425 || status >= 500) {
    return true;
  }
  if ((status === 400 || status === 401 || status === 403) && isUpstreamPoolError(bodyText)) {
    return true;
  }
  return false;
}

export function extractSseErrorStatus(errObj: Record<string, unknown>): number {
  if (typeof errObj.status === 'number' && Number.isFinite(errObj.status)) {
    return errObj.status;
  }
  if (typeof errObj.status_code === 'number' && Number.isFinite(errObj.status_code)) {
    return errObj.status_code;
  }
  const msg = typeof errObj.message === 'string' ? errObj.message : '';
  const code = typeof errObj.code === 'string' ? errObj.code : '';
  const httpMatch = /HTTP\s+(\d{3})/i.exec(msg);
  if (httpMatch?.[1]) {
    const parsed = Number(httpMatch[1]);
    if (Number.isFinite(parsed) && parsed >= 400 && parsed <= 599) {
      return parsed;
    }
  }
  const combined = `${code} ${msg}`.toLowerCase();
  if (combined.includes('rate_limit') || combined.includes('too many requests') || combined.includes('429')) {
    return 429;
  }
  return 502;
}
