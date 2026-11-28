import { describe, expect, it, vi } from 'vitest';
import {
  downloadInitImageAttachment,
  extractImageDimensions,
  inferClosestImageAspectRatio,
  MAX_INIT_IMAGE_BYTES,
  validateInitAttachmentMeta,
} from '../../src/services/image/imageInitLoader.js';

function makePngWithSize(width: number, height: number): Buffer {
  const buf = Buffer.alloc(32);
  // PNG signature
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  // IHDR chunk length (13) + "IHDR"
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function makeGif89aWithSize(width: number, height: number): Buffer {
  const buf = Buffer.alloc(14);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function makeJpegSofWithSize(width: number, height: number, markerByte = 0xc0): Buffer {
  // SOI + APP0 (length 4) + SOF0/SOF2 (length 11)
  return Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0
    0xff, markerByte, 0x00, 0x0b, 0x08, // SOF marker, len=11, precision=8
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00,
  ]);
}

function makeWebpVp8WithSize(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  // Keyframe signature 0x9d 0x01 0x2a at offset 23
  buf[23] = 0x9d;
  buf[24] = 0x01;
  buf[25] = 0x2a;
  buf.writeUInt16LE(width & 0x3fff, 26);
  buf.writeUInt16LE(height & 0x3fff, 28);
  return buf;
}

function makeWebpVp8LWithSize(width: number, height: number): Buffer {
  const buf = Buffer.alloc(25);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(17, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8L', 12, 'ascii');
  buf.writeUInt32LE(5, 16);
  buf[20] = 0x2f;
  const packed = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  buf.writeUInt32LE(packed >>> 0, 21);
  return buf;
}

function makeWebpVp8XWithSize(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  // width-1 (24-bit LE at 24..26), height-1 (24-bit LE at 27..29)
  const wm1 = width - 1;
  const hm1 = height - 1;
  buf[24] = wm1 & 0xff;
  buf[25] = (wm1 >> 8) & 0xff;
  buf[26] = (wm1 >> 16) & 0xff;
  buf[27] = hm1 & 0xff;
  buf[28] = (hm1 >> 8) & 0xff;
  buf[29] = (hm1 >> 16) & 0xff;
  return buf;
}

describe('imageInitLoader', () => {
  it('extracts dimensions from PNG, JPEG (SOF0/SOF2), WebP (VP8/VP8L/VP8X), and GIF89a headers, and returns null on corrupt data', () => {
    expect(extractImageDimensions(makePngWithSize(832, 1216))).toEqual({ width: 832, height: 1216 });
    expect(extractImageDimensions(makeJpegSofWithSize(1200, 800, 0xc0))).toEqual({
      width: 1200,
      height: 800,
    });
    expect(extractImageDimensions(makeJpegSofWithSize(1920, 1080, 0xc2))).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(extractImageDimensions(makeWebpVp8WithSize(768, 1344))).toEqual({
      width: 768,
      height: 1344,
    });
    expect(extractImageDimensions(makeWebpVp8LWithSize(512, 512))).toEqual({
      width: 512,
      height: 512,
    });
    expect(extractImageDimensions(makeWebpVp8XWithSize(1000, 1000))).toEqual({
      width: 1000,
      height: 1000,
    });
    expect(extractImageDimensions(makeGif89aWithSize(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
    expect(extractImageDimensions(Buffer.from('not an image at all'))).toBeNull();
  });

  it('infers closest Opus 0-Anlas aspect ratio from source dimensions', () => {
    expect(inferClosestImageAspectRatio(600, 900)).toBe('2:3');
    expect(inferClosestImageAspectRatio(720, 1280)).toBe('9:16');
    expect(inferClosestImageAspectRatio(1000, 1000)).toBe('1:1');
    expect(inferClosestImageAspectRatio(1200, 800)).toBe('3:2');
    expect(inferClosestImageAspectRatio(1920, 1080)).toBe('16:9');
  });

  it('validates attachment metadata synchronously and downloads valid init images into data URLs', async () => {
    expect(
      validateInitAttachmentMeta({
        url: 'https://cdn.example/doc.pdf',
        contentType: 'application/pdf',
        size: 1024,
        name: 'doc.pdf',
      }).ok,
    ).toBe(false);

    expect(
      validateInitAttachmentMeta({
        url: 'https://cdn.example/huge.png',
        contentType: 'image/png',
        size: MAX_INIT_IMAGE_BYTES + 1,
        name: 'huge.png',
      }).ok,
    ).toBe(false);

    expect(
      validateInitAttachmentMeta({
        url: 'https://cdn.example/ok.png',
        contentType: 'image/png',
        size: 4096,
        name: 'ok.png',
      }),
    ).toEqual({ ok: true, mime: 'image/png' });

    const failStatusRes = await downloadInitImageAttachment(
      { url: 'https://cdn.example/fail.png', contentType: 'image/png', size: 512, name: 'fail.png' },
      vi.fn(async () => new Response('err', { status: 500 })) as unknown as typeof fetch,
    );
    expect(failStatusRes.ok).toBe(false);

    const emptyRes = await downloadInitImageAttachment(
      { url: 'https://cdn.example/empty.png', contentType: 'image/png', size: 128, name: 'empty.png' },
      vi.fn(async () => new Response(new Uint8Array(), { status: 200 })) as unknown as typeof fetch,
    );
    expect(emptyRes.ok).toBe(false);

    const validPng = makePngWithSize(832, 1216);
    const okRes = await downloadInitImageAttachment(
      {
        url: 'https://cdn.example/base.png',
        contentType: 'image/png',
        size: validPng.length,
        name: 'base.png',
      },
      vi.fn(async () => new Response(validPng, { status: 200 })) as unknown as typeof fetch,
    );
    expect(okRes).toEqual({
      ok: true,
      dataUrl: `data:image/png;base64,${validPng.toString('base64')}`,
      width: 832,
      height: 1216,
      inferredAspectRatio: '2:3',
    });
  });
});
