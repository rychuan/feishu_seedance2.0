import { SEEDANCE_CREATE_TASK_URL, MODEL_OPTIONS, RESOLUTION_OPTIONS, RATIO_OPTIONS, SERVICE_TIER_OPTIONS } from '../constants';
import { FormItemParams, SeedanceContentItem, SeedanceCreateResponse, TaskResult } from '../types';
import {
  extractImageAttachments,
  extractVideoAttachments,
  extractAudioAttachments,
  mergeAttachmentFields,
  batchDownloadAndEncode,
  batchDownloadAndUploadVideos,
  batchDownloadAndUploadAudios,
  countAttachments,
  checkR2VPixelLimit,
} from '../utils/media';
import { SafeFetchFn, sanitizeForOutput } from '../utils/fetch';
import { sleep } from '../utils/poll';

const MAX_CREATE_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

const IMAGE_FIELD_KEYS = ['imageField', 'imageField2'];
const VIDEO_FIELD_KEYS = ['videoField'];
const AUDIO_FIELD_KEYS = ['audioField'];

export function validateParams(params: FormItemParams): string | null {
  if (!params.apiKey) return '请输入火山引擎 API Key';
  if (!params.prompt) return '请选择提示词字段';

  const promptText = typeof params.prompt === 'string' ? params.prompt : '';
  if (promptText.length > 4000) {
    return `提示词过长（${promptText.length} 字），最多支持 4000 字`;
  }

  if (params.model) {
    const validModels = MODEL_OPTIONS.map((o) => o.value);
    if (!validModels.includes(params.model as any)) {
      return `不支持的模型: ${params.model}`;
    }
  }

  if (params.resolution) {
    const validResolutions = RESOLUTION_OPTIONS.map((o) => o.value);
    if (!validResolutions.includes(params.resolution as any)) {
      return `不支持的分辨率: ${params.resolution}`;
    }
  }

  if (params.ratio) {
    const validRatios = RATIO_OPTIONS.map((o) => o.value);
    if (!validRatios.includes(params.ratio as any)) {
      return `不支持的宽高比: ${params.ratio}`;
    }
  }

  if (params.serviceTier) {
    const validTiers = SERVICE_TIER_OPTIONS.map((o) => o.value);
    if (!validTiers.includes(params.serviceTier as any)) {
      return `不支持的服务等级: ${params.serviceTier}`;
    }
  }

  if (params.duration) {
    const durNum = parseInt(params.duration, 10);
    if (durNum < 4 || durNum > 15) {
      return `时长 ${durNum} 秒超出范围，Seedance 2.0 支持 4~15 秒`;
    }
  }

  const imageCount = countAttachments(params, IMAGE_FIELD_KEYS, 'image');
  const videoCount = countAttachments(params, VIDEO_FIELD_KEYS, 'video');
  const audioCount = countAttachments(params, AUDIO_FIELD_KEYS, 'audio');
  if (imageCount > 9) return '图片最多支持9张';
  if (videoCount > 3) return '视频最多支持3段';
  if (audioCount > 3) return '音频最多支持3段';

  return null;
}

export async function buildContent(
  params: FormItemParams,
  rawFetch: (url: string, init?: any, authId?: string) => Promise<any>,
  debugLog: (arg: any) => void
): Promise<{ content: SeedanceContentItem[]; warnings: string[] }> {
  const content: SeedanceContentItem[] = [];
  const warnings: string[] = [];

  const textPrompt = (params.prompt as string) || '';
  content.push({ type: 'text', text: textPrompt });

  const allImages = mergeAttachmentFields(params, IMAGE_FIELD_KEYS);
  const imageAttachments = extractImageAttachments(allImages);

  if (imageAttachments.length >= 1) {
    const result = await batchDownloadAndEncode(imageAttachments.slice(0, 9), rawFetch, 9, debugLog);
    const base64Uris = result.successes;

    if (result.failures > 0) {
      warnings.push(`${result.failures}张图片下载失败`);
    }

    // r2v 像素限制校验 — 对首帧和尾帧图片检查分辨率
    // 因为 r2v 模式要求 width x height <= 927,408
    if (base64Uris.length >= 1) {
      const firstName = imageAttachments[0]?.name || '首帧图片';
      checkR2VPixelLimit(base64Uris[0], firstName);
      content.push({
        type: 'image_url',
        image_url: { url: base64Uris[0] },
        role: 'first_frame',
      });
    }
    if (base64Uris.length >= 2) {
      const secondName = imageAttachments[1]?.name || '尾帧图片';
      checkR2VPixelLimit(base64Uris[1], secondName);
      content.push({
        type: 'image_url',
        image_url: { url: base64Uris[1] },
        role: 'last_frame',
      });
    }
    for (let i = 2; i < base64Uris.length; i++) {
      content.push({
        type: 'image_url',
        image_url: { url: base64Uris[i] },
        role: 'reference',
      });
    }
  }

  const allVideos = mergeAttachmentFields(params, VIDEO_FIELD_KEYS);
  const videoAttachments = extractVideoAttachments(allVideos).slice(0, 3);
  if (videoAttachments.length > 0) {
    const result = await batchDownloadAndUploadVideos(videoAttachments, rawFetch, 3, debugLog);
    for (const url of result.successes) {
      content.push({
        type: 'video_url',
        video_url: { url },
        role: 'reference',
      });
    }
    if (result.failures > 0) {
      warnings.push(`${result.failures}个视频处理失败`);
    }
  }

  const allAudios = mergeAttachmentFields(params, AUDIO_FIELD_KEYS);
  const audioAttachments = extractAudioAttachments(allAudios).slice(0, 3);
  if (audioAttachments.length > 0) {
    const result = await batchDownloadAndUploadAudios(audioAttachments, rawFetch, 3, debugLog);
    for (const url of result.successes) {
      content.push({
        type: 'audio_url',
        audio_url: { url },
        role: 'reference',
      });
    }
    if (result.failures > 0) {
      warnings.push(`${result.failures}个音频处理失败`);
    }
  }

  return { content, warnings };
}

/**
 * 构建 Seedance API 请求体。
 * 所有布尔字段只在 true 时写入，让 API 自行处理默认值（false）。
 */
function buildRequestBody(params: FormItemParams, content: SeedanceContentItem[]): Record<string, any> {
  const body: Record<string, any> = {
    model: params.model,
    content,
  };

  if (params.duration) {
    body.duration = parseInt(params.duration, 10);
  }
  if (params.ratio) {
    body.ratio = params.ratio;
  }
  if (params.watermark) {
    body.watermark = true;
  }
  if (params.generateAudio) {
    body.generate_audio = true;
  }
  if (params.returnLastFrame) {
    body.return_last_frame = true;
  }
  if (params.cameraFixed) {
    body.camera_fixed = true;
  }
  if (params.serviceTier) {
    body.service_tier = params.serviceTier;
  }
  if (params.seed && params.seed !== '-1') {
    const seedNum = parseInt(params.seed, 10);
    if (!isNaN(seedNum) && seedNum >= -1) {
      body.seed = seedNum;
    }
  }

  return body;
}

export async function createVideoTask(
  params: FormItemParams,
  safeFetch: SafeFetchFn,
  rawFetch: (url: string, init?: any, authId?: string) => Promise<any>,
  debugLog: (arg: any) => void
): Promise<TaskResult> {
  const { content, warnings } = await buildContent(params, rawFetch, debugLog);
  const requestBody = buildRequestBody(params, content);

  const logBody = {
    ...requestBody,
    content: content.map((item) => {
      if (item.type === 'image_url' && item.image_url?.url?.startsWith('data:')) {
        return { ...item, image_url: { url: item.image_url.url.slice(0, 80) + '...[base64]' } };
      }
      return item;
    }),
  };
  debugLog({ '===请求体': logBody });

  let lastError = '';
  for (let attempt = 0; attempt <= MAX_CREATE_RETRIES; attempt++) {
    if (attempt > 0) {
      debugLog({ '===任务创建重试': { attempt, lastError } });
      await sleep(RETRY_DELAY_MS);
    }

    const res = await safeFetch<SeedanceCreateResponse>(
      SEEDANCE_CREATE_TASK_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (res && typeof res === 'object' && 'code' in res && res.code === -1) {
      lastError = `网络请求失败: ${sanitizeForOutput(String(res.error))}`;
      continue;
    }

    if (res && typeof res === 'object' && 'error' in res && !(res as any).id) {
      const apiError = (res as any).error;
      const errorCode = apiError?.code || 'Unknown';
      const errorMsg = apiError?.message || JSON.stringify(apiError);

      const nonRetryableCodes = ['InvalidParameter', 'AuthenticationFailed', 'PermissionDenied', 'NotFound'];
      if (nonRetryableCodes.includes(errorCode)) {
        return { taskId: null, error: `API 错误 [${errorCode}]: ${errorMsg}`, warnings };
      }

      lastError = `API 错误 [${errorCode}]: ${errorMsg}`;
      continue;
    }

    const taskId = (res as SeedanceCreateResponse)?.id;
    if (!taskId) {
      lastError = `创建任务失败，响应中无 taskId: ${sanitizeForOutput(JSON.stringify(res)).slice(0, 500)}`;
      continue;
    }

    return { taskId, error: null, warnings };
  }

  return { taskId: null, error: `任务创建失败（已重试 ${MAX_CREATE_RETRIES} 次）: ${lastError}`, warnings };
}
