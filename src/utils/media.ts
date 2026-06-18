import https from 'https';
import { LITTERBOX_UPLOAD_URL, LITTERBOX_EXPIRY } from '../constants';
import { Attachment } from '../types';

const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_UPLOAD_RETRIES = 2;
const UPLOAD_RETRY_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


export interface BatchResult {
  successes: string[];
  failures: number;
}

function cleanUrl(url: string): string {
  return url.replace(/^[`'"\s]+|[`'"\s]+$/g, '');
}

function inferFormat(mimeType: string, fileName: string): string {
  if (mimeType) {
    const match = mimeType.match(/\/(jpeg|png|webp|bmp|tiff|gif|mp4|mov|avi|mkv|webm|mp3|wav|aac|ogg|flac)$/i);
    if (match) return match[1].toLowerCase();
  }
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'jpg') return 'jpeg';
    if (ext) return ext;
  }
  return 'jpeg';
}

function inferMediaCategory(mimeType: string, fileName: string): 'image' | 'video' | 'audio' {
  if (mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
  }
  if (fileName) {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'mpeg'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
  }
  return 'image';
}

function extractByType(attachmentValue: Attachment[], mimePrefix: string, extRegex: RegExp): Attachment[] {
  if (!attachmentValue) return [];
  if (!Array.isArray(attachmentValue)) return [];
  return attachmentValue.filter((item: Attachment) => {
    const fileType = item.type || item.mimeType || '';
    if (fileType.startsWith(mimePrefix)) return true;
    const name = (item.name || '').toLowerCase();
    return extRegex.test(name);
  });
}

export function extractImageAttachments(attachmentValue: Attachment[]): Attachment[] {
  return extractByType(attachmentValue, 'image/', /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i);
}

export function extractVideoAttachments(attachmentValue: Attachment[]): Attachment[] {
  return extractByType(attachmentValue, 'video/', /\.(mp4|mov|avi|mkv|webm|flv|wmv)$/i);
}

export function extractAudioAttachments(attachmentValue: Attachment[]): Attachment[] {
  return extractByType(attachmentValue, 'audio/', /\.(mp3|wav|aac|ogg|flac|m4a|wma)$/i);
}

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
  if (!Array.isArray(attachments) || attachments.length === 0) return { successes: [], failures: 0 };

  const successes: string[] = [];
  let failures = 0;
  const items = attachments.slice(0, maxCount);


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
      debugLog?.({ [`===图片 ${i + 1} 下载失败`]: { fileName: items[i]?.name || '', error: String(result.reason) } });
    }
  }

  return { successes, failures };
}

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
  if (!Array.isArray(attachments) || attachments.length === 0) return { successes: [], failures: 0 };

  const successes: string[] = [];
  let failures = 0;
  const items = attachments.slice(0, maxCount);

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
      debugLog?.({ [`===视频 ${i + 1} 处理失败`]: { fileName: items[i]?.name || `video_${i}.mp4`, error: String(result.reason) } });
    }
  }

  return { successes, failures };
}

export async function batchDownloadAndUploadAudios(
  attachments: any[],
  rawFetch: (url: string, init?: any, authId?: string) => Promise<any>,
  maxCount: number,
  debugLog?: (arg: any) => void
): Promise<BatchResult> {
  if (!Array.isArray(attachments) || attachments.length === 0) return { successes: [], failures: 0 };

  const successes: string[] = [];
  let failures = 0;
  const items = attachments.slice(0, maxCount);

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
      debugLog?.({ [`===音频 ${i + 1} 处理失败`]: { fileName: items[i]?.name || `audio_${i}.mp3`, error: String(result.reason) } });
    }
  }

  return { successes, failures };
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
