import { VALID_IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from '../../config/defaults.js';

export const MAX_INIT_IMAGE_BYTES = 10 * 1024 * 1024;
export const INIT_IMAGE_FETCH_TIMEOUT_MS = 15_000;

export const ALLOWED_INIT_IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const EXT_TO_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const OPUS_RATIO_TABLE: ReadonlyArray<{ ratio: ImageAspectRatio; value: number }> = [
  { ratio: '2:3', value: 832 / 1216 },
  { ratio: '3:2', value: 1216 / 832 },
  { ratio: '1:1', value: 1024 / 1024 },
  { ratio: '9:16', value: 768 / 1344 },
  { ratio: '16:9', value: 1344 / 768 },
];

export interface InitAttachmentLike {
  url: string;
  contentType?: string | null;
  size?: number | null;
  name?: string | null;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export type InitAttachmentValidationResult =
  | { ok: true; mime: string }
  | { ok: false; errorMessage: string };

export type DownloadInitImageResult =
  | {
      ok: true;
      dataUrl: string;
      width: number | null;
      height: number | null;
      inferredAspectRatio: ImageAspectRatio | null;
    }
  | { ok: false; errorMessage: string };

function normalizeMime(rawMime: string | null | undefined, fileName?: string | null): string | null {
  const cleaned = rawMime?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (cleaned === 'image/jpg') return 'image/jpeg';
  if (cleaned && ALLOWED_INIT_IMAGE_MIMES.has(cleaned)) return cleaned;
  if (cleaned) return cleaned;

  const lowerName = fileName?.trim().toLowerCase() ?? '';
  for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
    if (lowerName.endsWith(ext)) {
      return mime;
    }
  }
  return null;
}

function detectMimeFromBuffer(buf: Buffer): string | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 6) {
    const sig6 = buf.toString('ascii', 0, 6);
    if (sig6 === 'GIF87a' || sig6 === 'GIF89a') {
      return 'image/gif';
    }
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function extractJpegDimensions(buf: Buffer): ImageDimensions | null {
  let offset = 2;
  while (offset + 1 < buf.length) {
    while (offset < buf.length && buf[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= buf.length) break;
    const marker = buf[offset]!;
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      continue;
    }
    if (offset + 2 > buf.length) break;
    const segLen = buf.readUInt16BE(offset);
    if (segLen < 2 || offset + segLen > buf.length) break;

    const isSofMarker =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSofMarker && segLen >= 7 && offset + 7 <= buf.length) {
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      if (width > 0 && height > 0) {
        return { width, height };
      }
      return null;
    }

    offset += segLen;
  }
  return null;
}

function extractWebpDimensions(buf: Buffer): ImageDimensions | null {
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const payload = offset + 8;

    if (chunkId === 'VP8 ' && payload + 10 <= buf.length) {
      if (buf[payload + 3] === 0x9d && buf[payload + 4] === 0x01 && buf[payload + 5] === 0x2a) {
        const width = buf.readUInt16LE(payload + 6) & 0x3fff;
        const height = buf.readUInt16LE(payload + 8) & 0x3fff;
        if (width > 0 && height > 0) return { width, height };
      }
    } else if (chunkId === 'VP8L' && payload + 5 <= buf.length && buf[payload] === 0x2f) {
      const packed = buf.readUInt32LE(payload + 1);
      const width = (packed & 0x3fff) + 1;
      const height = ((packed >> 14) & 0x3fff) + 1;
      if (width > 0 && height > 0) return { width, height };
    } else if (chunkId === 'VP8X' && payload + 10 <= buf.length) {
      const width = 1 + (buf[payload + 4]! | (buf[payload + 5]! << 8) | (buf[payload + 6]! << 16));
      const height = 1 + (buf[payload + 7]! | (buf[payload + 8]! << 8) | (buf[payload + 9]! << 16));
      if (width > 0 && height > 0) return { width, height };
    }

    const step = chunkSize + (chunkSize & 1);
    if (step <= 0) break;
    offset = payload + step;
  }
  return null;
}

/**
 * Extracts pixel dimensions directly from PNG, JPEG, WebP, or GIF file headers
 * without pulling in native image dependencies.
 */
export function extractImageDimensions(buf: Buffer): ImageDimensions | null {
  const mime = detectMimeFromBuffer(buf);
  if (!mime) return null;

  if (mime === 'image/png' && buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (mime === 'image/gif' && buf.length >= 10) {
    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (mime === 'image/jpeg') {
    return extractJpegDimensions(buf);
  }

  if (mime === 'image/webp') {
    return extractWebpDimensions(buf);
  }

  return null;
}

/**
 * Maps arbitrary source image dimensions to the closest NovelAI Opus 0-Anlas aspect ratio.
 */
export function inferClosestImageAspectRatio(width: number, height: number): ImageAspectRatio {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return VALID_IMAGE_ASPECT_RATIOS[0];
  }
  const actualRatio = width / height;
  let best = OPUS_RATIO_TABLE[0]!;
  let bestDist = Infinity;
  for (const candidate of OPUS_RATIO_TABLE) {
    const dist = Math.abs(Math.log(actualRatio / candidate.value));
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best.ratio;
}

export function validateInitAttachmentMeta(
  attachment: InitAttachmentLike,
): InitAttachmentValidationResult {
  if (typeof attachment.size === 'number' && attachment.size > MAX_INIT_IMAGE_BYTES) {
    const mb = (attachment.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      errorMessage: `垫图文件过大（${mb} MB），最大支持 ${MAX_INIT_IMAGE_BYTES / (1024 * 1024)} MB 以内的 PNG / JPG / WebP / GIF 图片。`,
    };
  }

  const mime = normalizeMime(attachment.contentType, attachment.name);
  if (!mime || !ALLOWED_INIT_IMAGE_MIMES.has(mime)) {
    return {
      ok: false,
      errorMessage: '请上传受支持的图片格式（PNG / JPG / WebP / GIF）。',
    };
  }

  return { ok: true, mime };
}

/**
 * Validates and downloads a Discord attachment (or message image) into a Base64 data URL
 * along with extracted dimensions and best-matching Opus 0-Anlas aspect ratio.
 */
export async function downloadInitImageAttachment(
  attachment: InitAttachmentLike,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<DownloadInitImageResult> {
  const metaCheck = validateInitAttachmentMeta(attachment);
  if (!metaCheck.ok) {
    return metaCheck;
  }

  const url = attachment.url?.trim() ?? '';
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    return {
      ok: false,
      errorMessage: '无效的垫图链接，无法下载底图。',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INIT_IMAGE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) {
      return {
        ok: false,
        errorMessage: `下载垫图失败（HTTP ${res.status}），请稍后重试或重新上传图片。`,
      };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      return {
        ok: false,
        errorMessage: '下载到的垫图内容为空，请重新上传图片。',
      };
    }
    if (buf.length > MAX_INIT_IMAGE_BYTES) {
      const mb = (buf.length / (1024 * 1024)).toFixed(1);
      return {
        ok: false,
        errorMessage: `垫图体积超过上限（${mb} MB > ${MAX_INIT_IMAGE_BYTES / (1024 * 1024)} MB）。`,
      };
    }

    const sniffedMime = detectMimeFromBuffer(buf);
    const resolvedMime = sniffedMime ?? metaCheck.mime;
    if (!ALLOWED_INIT_IMAGE_MIMES.has(resolvedMime)) {
      return {
        ok: false,
        errorMessage: '无法识别该垫图的图片编码，仅支持 PNG / JPG / WebP / GIF。',
      };
    }

    const dims = extractImageDimensions(buf);
    const inferredAspectRatio = dims ? inferClosestImageAspectRatio(dims.width, dims.height) : null;

    return {
      ok: true,
      dataUrl: `data:${resolvedMime};base64,${buf.toString('base64')}`,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      inferredAspectRatio,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      errorMessage: isAbort
        ? '下载垫图超时，请检查网络或重新上传图片后再试。'
        : '下载垫图时发生异常，请稍后重试。',
    };
  } finally {
    clearTimeout(timer);
  }
}
