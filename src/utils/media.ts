import https from 'https';
import { sleep } from './poll';
import {
  LITTERBOX_UPLOAD_URL,
  LITTERBOX_EXPIRY,
  MEDIA_EXTENSIONS,
  MEDIA_MIME_EXT_MAP,
  R2V_MAX_PIXELS,
} from '../constants';
import { Attachment } from '../types';

const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_UPLOAD_RETRIES = 2;
const UPLOAD_RETRY_DELAY_MS = 3000;

export interface BatchResult {
  successes: string[];
  failures: number;
  failedNames: string[];
}

// ---- Helpers: url / format / category ----

function cleanUrl(url: string): string {
  return url.replace(/^[`'"\s]+|[`'"\s]+$/g, '');
}

/** 从 mimeType 中提取格式后缀，回退到文件名扩展名，最终回退到 'jpeg' */
function inferFormat(mimeType: string, fileName: string): string {
  if (mimeType) {
    const mapped = MEDIA_MIME_EXT_MAP[mimeType.toLowerCase()];
    if (mapped) return mapped;
    const match = mimeType.match(/\/([\w+-]+)$/i);
    if (match) return match[1].toLowerCase();
  }
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'jpg') return 'jpeg';
    if (ext) return ext;
  }
  return 'jpeg';
}

/** 按 mimeType / 文件名扩展名推断媒体大类 */
function inferMediaCategory(mimeType: string, fileName: string): 'image' | 'video' | 'audio' {
  if (mimeType) {
    const lower = mimeType.toLowerCase();
    if (lower.startsWith('image/')) return 'image';
    if (lower.startsWith('video/')) return 'video';
    if (lower.startsWith('audio/')) return 'audio';
  }
  if (fileName) {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if ((MEDIA_EXTENSIONS.image as readonly string[]).includes(ext)) return 'image';
    if ((MEDIA_EXTENSIONS.video as readonly string[]).includes(ext)) return 'video';
    if ((MEDIA_EXTENSIONS.audio as readonly string[]).includes(ext)) return 'audio';
  }
  return 'image';
}

// ---- Attachment extraction (unified via MEDIA_EXTENSIONS) ----

function extractByType(
  attachmentValue: Attachment[],
  mimePrefix: string,
  category: keyof typeof MEDIA_EXTENSIONS,
): Attachment[] {
  if (!attachmentValue) return [];
  if (!Array.isArray(attachmentValue)) return [];
  const extList = MEDIA_EXTENSIONS[category];
  const extPattern = new RegExp(`\\.(${extList.join('|')})$`, 'i');
  return attachmentValue.filter((item: Attachment) => {
    const fileType = (item.type || item.mimeType || '').toLowerCase();
    if (fileType.startsWith(mimePrefix)) return true;
    const name = (item.name || '').toLowerCase();
    return extPattern.test(name);
  });
}

export function extractImageAttachments(attachmentValue: Attachment[]): Attachment[] {
  return extractByType(attachmentValue, 'image/', 'image');
}

export function extractVideoAttachments(attachmentValue: Attachment[]): Attachment[] {
  return extractByType(attachmentValue, 'video/', 'video');
}

export function extractAudioAttachments(attachmentValue: Attachment[]): Attachment[] {
  return extractByType(attachmentValue, 'audio/', 'audio');
}

// ---- Merge & count (countAttachments 直接委托给 extract* 避免重复逻辑) ----

export function mergeAttachmentFields(params: any, fieldKeys: string[]): Attachment[] {
  const merged: Attachment[] = [];
  const seen = new Set<string>();
  for (const key of fieldKeys) {
    const fieldData = params[key];
    if (Array.isArray(fieldData) && fieldData.length > 0) {
      for (const item of (fieldData as Attachment[])) {
        const dedupKey = item.tmp_url || item.url || item.name || '';
        if (dedupKey) {
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
        }
        merged.push(item);
      }
    }
  }
  return merged;
}

export function countAttachments(
  params: any,
  fieldKeys: string[],
  category: 'image' | 'video' | 'audio',
): number {
  const all = mergeAttachmentFields(params, fieldKeys);
  if (category === 'image') return extractImageAttachments(all).length;
  if (category === 'video') return extractVideoAttachments(all).length;
  return extractAudioAttachments(all).length;
}

// ---- Download ----

async function downloadAttachment(
  tmpUrl: string,
  rawFetch: (url: string, init?: any, authId?: string) => Promise<any>,
  debugLog?: (arg: any) => void
): Promise<Buffer> {
  const url = cleanUrl(tmpUrl);
  if (!url || !url.startsWith('http')) {
    throw new Error(`无效的附件 URL: ${url}`);
  }

  const response = await rawFetch(url, { method: 'GET' });
  const statusCode = response?.status;
  const isOk = response?.ok !== false && (!statusCode || statusCode < 400);
  if (!response || !isOk) {
    throw new Error(`下载附件失败: HTTP ${statusCode || '无响应'}`);
  }

  let buffer: Buffer;
  if (typeof response.buffer === 'function') {
    buffer = await response.buffer();
  } else if (typeof response.arrayBuffer === 'function') {
    buffer = Buffer.from(await response.arrayBuffer());
  } else if (typeof response.text === 'function') {
    // 注意: text() 默认 UTF-8 解码可能破坏二进制数据，
    // 这是飞书 FaaS 非标准 Response 的最后回退方案
    buffer = Buffer.from(await response.text(), 'binary');
  } else {
    throw new Error('context.fetch 返回的 response 不支持 buffer/arrayBuffer/text 方法');
  }
  return buffer;
}

// ---- Image: download + base64 encode + pixel check ----

export async function downloadAndEncodeBase64(
  tmpUrl: string,
  mimeType: string,
  fileName: string,
  rawFetch: (url: string, init?: any, authId?: string) => Promise<any>
): Promise<string> {
  const buffer = await downloadAttachment(tmpUrl, rawFetch);

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`图片过大 (${(buffer.length / 1024 / 1024).toFixed(1)}MB)，最大支持 ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB`);
  }

  const base64 = buffer.toString('base64');
  const format = inferFormat(mimeType, fileName);
  const category = inferMediaCategory(mimeType, fileName);

  return `data:${category}/${format};base64,${base64}`;
}

export async function batchDownloadAndEncode(
  attachments: any[],
  rawFetch: (url: string, init?: any, authId?: string) => Promise<any>,
  maxCount: number,
  debugLog?: (arg: any) => void
): Promise<BatchResult> {
  if (!Array.isArray(attachments) || attachments.length === 0) return { successes: [], failures: 0, failedNames: [] };

  const successes: string[] = [];
  let failures = 0;
  const items = attachments.slice(0, maxCount);
  const failedNames: string[] = [];

  const results = await Promise.allSettled(
    items.map(async (item, i) => {
      const url = cleanUrl(item.tmp_url || item.url || '');
      const mimeType = item.type || item.mimeType || '';
      const fileName = item.name || '';

      const logKey1 = `===下载图片 ${i + 1}/${items.length}`;
      debugLog?.({ [logKey1]: { fileName, mimeType, urlLength: url.length } });
      const base64Uri = await downloadAndEncodeBase64(url, mimeType, fileName, rawFetch);
      const logKey2 = `===图片 ${i + 1} 编码完成`;
      debugLog?.({ [logKey2]: { fileName, base64Length: base64Uri.length } });
      return base64Uri;
    })
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      successes.push(result.value);
    } else {
      failures++;
      failedNames.push(items[i]?.name || "unknown");
      debugLog?.({ [`===图片 ${i + 1} 下载失败`]: { fileName: items[i]?.name || '', error: String(result.reason) } });
    }
  }

  return { successes, failures, failedNames };
}

// ---- litterbox upload (https native, with retry) ----

async function uploadToLitterboxOnce(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  debugLog?: (arg: any) => void
): Promise<string> {
  if (fileBuffer.length > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error(`文件过大 (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB)，最大支持 ${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024}MB`);
  }

  const boundary = `----FormBoundary${Date.now()}`;
  const safeFileName = `file_${Date.now()}_${fileName}`;

  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="time"\r\n\r\n${LITTERBOX_EXPIRY}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="${safeFileName}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const multipartBody = Buffer.concat(parts);

  debugLog?.({ '===上传到临时托管': { fileName: safeFileName, sizeMB: (fileBuffer.length / 1024 / 1024).toFixed(2) } });

  return new Promise<string>((resolve, reject) => {
    const urlObj = new URL(LITTERBOX_UPLOAD_URL);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipartBody.length,
      },
      timeout: 120000,
    };

    const req = https.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const publicUrl = data.trim();
          if (publicUrl.startsWith('http')) {
            resolve(publicUrl);
          } else {
            reject(new Error(`上传返回了非 URL 内容: ${data.slice(0, 200)}`));
          }
        } else {
          reject(new Error(`上传失败: HTTP ${res.statusCode}, ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (err: any) => reject(new Error(`上传请求失败: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('上传超时（120秒）')); });
    req.write(multipartBody);
    req.end();
  });
}

async function uploadToLitterbox(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  debugLog?: (arg: any) => void
): Promise<string> {
  return uploadToLitterboxWithRetry(fileBuffer, fileName, contentType, debugLog, 0);
}

async function uploadToLitterboxWithRetry(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  debugLog?: (arg: any) => void,
  attempt: number = 0
): Promise<string> {
  try {
    return await uploadToLitterboxOnce(fileBuffer, fileName, contentType, debugLog);
  } catch (e) {
    const isLastAttempt = attempt >= MAX_UPLOAD_RETRIES;
    debugLog?.({ '===上传重试': { fileName, attempt: attempt + 1, maxRetries: MAX_UPLOAD_RETRIES, error: String(e), isLastAttempt } });
    if (isLastAttempt) {
      throw e;
    }
    await sleep(UPLOAD_RETRY_DELAY_MS);
    return uploadToLitterboxWithRetry(fileBuffer, fileName, contentType, debugLog, attempt + 1);
  }
}

// ---- Video / Audio: download + upload ----

export async function downloadAndUploadVideo(
  tmpUrl: string,
  fileName: string,
  rawFetch: (url: string, init?: any, authId?: string) => Promise<any>,
  debugLog?: (arg: any) => void
): Promise<string> {
  debugLog?.({ '===下载视频附件': { fileName } });
  const buffer = await downloadAttachment(tmpUrl, rawFetch, debugLog);
  debugLog?.({ '===视频下载完成': { fileName, sizeMB: (buffer.length / 1024 / 1024).toFixed(2) } });

  if (buffer.length > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error(`视频文件过大 (${(buffer.length / 1024 / 1024).toFixed(1)}MB)，最大支持 ${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024}MB`);
  }

  const publicUrl = await uploadToLitterbox(buffer, fileName, 'video/mp4', debugLog);
  debugLog?.({ '===视频上传成功': { publicUrl } });
  return publicUrl;
}

export async function downloadAndUploadAudio(
  tmpUrl: string,
  fileName: string,
  rawFetch: (url: string, init?: any, authId?: string) => Promise<any>,
  debugLog?: (arg: any) => void
): Promise<string> {
  debugLog?.({ '===下载音频附件': { fileName } });
  const buffer = await downloadAttachment(tmpUrl, rawFetch, debugLog);
  debugLog?.({ '===音频下载完成': { fileName, sizeMB: (buffer.length / 1024 / 1024).toFixed(2) } });

  const publicUrl = await uploadToLitterbox(buffer, fileName, 'audio/mpeg', debugLog);
  debugLog?.({ '===音频上传成功': { publicUrl } });
  return publicUrl;
}

export async function batchDownloadAndUploadVideos(
  attachments: any[],
  rawFetch: (url: string, init?: any, authId?: string) => Promise<any>,
  maxCount: number,
  debugLog?: (arg: any) => void
): Promise<BatchResult> {
  if (!Array.isArray(attachments) || attachments.length === 0) return { successes: [], failures: 0, failedNames: [] };

  const successes: string[] = [];
  let failures = 0;
  const items = attachments.slice(0, maxCount);
  const failedNames: string[] = [];

  const results = await Promise.allSettled(
    items.map(async (item, i) => {
      const url = cleanUrl(item.tmp_url || item.url || '');
      const fileName = item.name || `video_${i}.mp4`;

      const logKey = `===处理视频 ${i + 1}/${items.length}`;
      debugLog?.({ [logKey]: { fileName } });
      const publicUrl = await downloadAndUploadVideo(url, fileName, rawFetch, debugLog);
      return publicUrl;
    })
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      successes.push(result.value);
    } else {
      failures++;
      failedNames.push(items[i]?.name || "unknown");
      debugLog?.({ [`===视频 ${i + 1} 处理失败`]: { fileName: items[i]?.name || `video_${i}.mp4`, error: String(result.reason) } });
    }
  }

  return { successes, failures, failedNames };
}

export async function batchDownloadAndUploadAudios(
  attachments: any[],
  rawFetch: (url: string, init?: any, authId?: string) => Promise<any>,
  maxCount: number,
  debugLog?: (arg: any) => void
): Promise<BatchResult> {
  if (!Array.isArray(attachments) || attachments.length === 0) return { successes: [], failures: 0, failedNames: [] };

  const successes: string[] = [];
  let failures = 0;
  const items = attachments.slice(0, maxCount);
  const failedNames: string[] = [];

  const results = await Promise.allSettled(
    items.map(async (item, i) => {
      const url = cleanUrl(item.tmp_url || item.url || '');
      const fileName = item.name || `audio_${i}.mp3`;

      const logKey = `===处理音频 ${i + 1}/${items.length}`;
      debugLog?.({ [logKey]: { fileName } });
      const publicUrl = await downloadAndUploadAudio(url, fileName, rawFetch, debugLog);
      return publicUrl;
    })
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      successes.push(result.value);
    } else {
      failures++;
      failedNames.push(items[i]?.name || "unknown");
      debugLog?.({ [`===音频 ${i + 1} 处理失败`]: { fileName: items[i]?.name || `audio_${i}.mp3`, error: String(result.reason) } });
    }
  }

  return { successes, failures, failedNames };
}

// ---- Pixel limit check (r2v mode) ----

/**
 * 对 base64 数据 URI 图片进行 r2v 像素限制校验。
 * 只在校验失败时抛出友好错误，不做实际压缩（FaaS 环境无 Canvas/ffmpeg）。
 */
export function checkR2VPixelLimit(
  base64Uri: string,
  fileName: string,
): void {
  // 从 data:image/xxx;base64,... 中解析出维度
  // PNG: 前 8 字节签名 + IHDR 第 16-23 字节 = width(4) + height(4)
  // JPEG: 需要遍历 SOF0/SOF2 段，这里用简化的 buffer 探测
  try {
    const base64Data = base64Uri.split(',')[1];
    if (!base64Data) return; // 无法解析则跳过校验
    const buf = Buffer.from(base64Data, 'base64');

    let width = 0, height = 0;

    // PNG: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      width = buf.readUInt32BE(16);
      height = buf.readUInt32BE(20);
    }
    // JPEG: FF D8
    else if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let offset = 2;
      while (offset < buf.length - 1) {
        if (buf[offset] !== 0xFF) break;
        const marker = buf[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          // SOF0 / SOF2
          height = buf.readUInt16BE(offset + 5);
          width = buf.readUInt16BE(offset + 7);
          break;
        }
        const segLen = buf.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    }
    // WebP: RIFF...WEBP
    else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
      // 简化: 只处理 VP8 (lossy) 和 VP8L 格式
      if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38) {
        if (buf[15] === 0x20) {
          // VP8: 宽度/高度在 tag 后的第 6-9 字节（含 3 字节帧头）
          const w = buf.readUInt16LE(26);
          const h = buf.readUInt16LE(30);
          width = w & 0x3FFF;
          height = h & 0x3FFF;
        } else if (buf[15] === 0x4C) {
          // VP8L: 宽度+高度存储在 4 字节中
          const bits = buf.readUInt32LE(21);
          width = (bits & 0x3FFF) + 1;
          height = ((bits >> 14) & 0x3FFF) + 1;
        }
      }
    }
    // GIF: GIF89a / GIF87a
    else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      width = buf.readUInt16LE(6);
      height = buf.readUInt16LE(8);
    }
    // BMP: BM
    else if (buf[0] === 0x42 && buf[1] === 0x4D) {
      width = buf.readInt32LE(18);
      height = Math.abs(buf.readInt32LE(22));
    }

    if (width > 0 && height > 0) {
      const pixels = width * height;
      if (pixels > R2V_MAX_PIXELS) {
        throw new Error(
          `图片 "${fileName}" 分辨率超限: ${width}x${height} = ${pixels.toLocaleString()} 像素，` +
          `r2v 模式上限为 ${R2V_MAX_PIXELS.toLocaleString()} 像素 ` +
          `(约 ${Math.floor(Math.sqrt(R2V_MAX_PIXELS))}x${Math.floor(Math.sqrt(R2V_MAX_PIXELS))})。` +
          `请在上传前将图片缩放到合规尺寸。`
        );
      }
    }
    // 无法解析格式时静默跳过
  } catch (e) {
    // 如果错误是我们自己抛的像素超限错误，继续抛出
    if (e instanceof Error && e.message.includes('分辨率超限')) throw e;
    // 其他解析异常静默跳过
  }
}
