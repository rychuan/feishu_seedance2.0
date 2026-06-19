import {
  basekit,
  FieldType,
  field,
  FieldComponent,
  FieldCode,
} from '@lark-opdev/block-basekit-server-api';
const { t } = field;

import {
  MODEL_OPTIONS,
  RESOLUTION_OPTIONS,
  RATIO_OPTIONS,
  DURATION_OPTIONS,
  GENERATE_AUDIO_OPTIONS,
  RETURN_LAST_FRAME_OPTIONS,
  WATERMARK_OPTIONS,
  CAMERA_FIXED_OPTIONS,
  SERVICE_TIER_OPTIONS,
  DOMAIN_WHITELIST,
  DEFAULT_MODEL,
  DEFAULT_RESOLUTION,
  DEFAULT_RATIO,
  DEFAULT_DURATION,
  DEFAULT_SERVICE_TIER,
} from './constants';
import { FormItemParams } from './types';
import { debugLog } from './utils/logger';
import { createSafeFetch } from './utils/fetch';
import { pollTask } from './utils/poll';
import { validateParams, createVideoTask } from './api/createTask';

basekit.addDomainList(DOMAIN_WHITELIST);

function normalizeSelect(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'value' in (val as Record<string, unknown>)) {
    return String((val as Record<string, unknown>).value);
  }
  return String(val);
}

/**
 * 解析 prompt 文本。飞书表格中的文本列可能以多种形式传递：
 * 纯字符串、text/value/link 对象的数组、或单个对象。
 * 返回非空的 prompt 字符串，或空字符串表示无有效输入。
 */
function parsePromptText(rawPrompt: unknown): string {
  if (typeof rawPrompt === 'string') return rawPrompt;

  if (Array.isArray(rawPrompt)) {
    return (rawPrompt as any[])
      .map((item: any) => {
        if (typeof item === 'string') return item;
        if (item?.text) return item.text;
        if (item?.value) return item.value;
        if (item?.link) return item.link;
        // 跳过纯占位符结果 ({}、[]、null)
        const s = JSON.stringify(item);
        if (s === '{}' || s === '[]' || s === 'null') return '';
        return s;
      })
      .filter(Boolean)
      .join(' ');
  }

  if (rawPrompt && typeof rawPrompt === 'object') {
    const obj = rawPrompt as any;
    if (obj.text) return obj.text;
    if (obj.value) return obj.value;
    if (obj.link) return obj.link;
    // 对象中无 text/value/link 字段时，检查是否是纯占位符
    const s = JSON.stringify(rawPrompt);
    if (s === '{}') return '';
    return s;
  }

  return '';
}

/**
 * 格式化成功结果。将 API 返回的视频 URL、尾帧、token、时长等信息
 * 拼接为 \n 分隔的文本输出（飞书字段捷径 Text 类型结果）。
 */
function formatResult(
  videoUrl: string,
  lastFrameUrl: string,
  tokens: number,
  duration: string,
  seed: number | undefined,
  warnings: string[],
): string {
  const parts = [`🎬 ${videoUrl}`];
  if (lastFrameUrl) {
    parts.push(`🖼️ 尾帧: ${lastFrameUrl}`);
  }
  parts.push(`📊 Token: ${tokens}`);
  parts.push(`⏱️ 时长: ${duration}s`);
  if (seed !== undefined) {
    parts.push(`🎲 种子: ${seed}`);
  }
  if (warnings.length > 0) {
    parts.push(`⚠️ ${warnings.join('，')}`);
  }
  return parts.join('\n');
}

basekit.addField({
  i18n: {
    messages: {
      'zh-CN': {
        field_name: 'Seedance 2.0 视频生成',
        field_desc: '调用 Seedance 2.0 API 生成视频，支持文本+图片+视频+音频四模态输入',
        api_key_label: 'API Key',
        api_key_placeholder: '请输入火山引擎 API Key',
        prompt_label: '提示词列',
        prompt_placeholder: '选择表格中的文本列作为提示词',
        image_label: '图片列 1（首帧/参考图）',
        image2_label: '图片列 2（尾帧/参考图，可选）',
        video_label: '视频列（运动/运镜参考）',
        audio_label: '音频列（音频风格参考）',
        model_label: '模型',
        resolution_label: '分辨率',
        ratio_label: '宽高比',
        duration_label: '视频时长',
        generate_audio_label: '生成音频',
        return_last_frame_label: '返回尾帧',
        watermark_label: '水印',
        camera_fixed_label: '固定摄像头',
        service_tier_label: '服务等级',
        seed_label: '随机种子',
        seed_placeholder: '-1（随机）',
      },
      'en-US': {
        field_name: 'Seedance 2.0 Video Gen',
        field_desc: 'Generate video via Seedance 2.0 API, supports text+image+video+audio multimodal input',
        api_key_label: 'API Key',
        api_key_placeholder: 'Enter Volcengine API Key',
        prompt_label: 'Prompt Column',
        prompt_placeholder: 'Select a text column as prompt',
        image_label: 'Image Column 1 (first frame/reference)',
        image2_label: 'Image Column 2 (last frame/reference, optional)',
        video_label: 'Video Column (motion reference)',
        audio_label: 'Audio Column (audio reference)',
        model_label: 'Model',
        resolution_label: 'Resolution',
        ratio_label: 'Aspect Ratio',
        duration_label: 'Duration',
        generate_audio_label: 'Generate Audio',
        return_last_frame_label: 'Return Last Frame',
        watermark_label: 'Watermark',
        camera_fixed_label: 'Camera Fixed',
        service_tier_label: 'Service Tier',
        seed_label: 'Seed',
        seed_placeholder: '-1 (random)',
      },
    },
  },
  formItems: [
    {
      key: 'apiKey',
      label: t('api_key_label'),
      component: FieldComponent.Input,
      props: { placeholder: t('api_key_placeholder') },
      validator: { required: true },
    },
    {
      key: 'prompt',
      label: t('prompt_label'),
      component: FieldComponent.FieldSelect,
      props: { supportType: [FieldType.Text] },
      validator: { required: true },
    },
    {
      key: 'imageField',
      label: t('image_label'),
      component: FieldComponent.FieldSelect,
      props: { supportType: [FieldType.Attachment] },
      validator: { required: false },
    },
    {
      key: 'imageField2',
      label: t('image2_label'),
      component: FieldComponent.FieldSelect,
      props: { supportType: [FieldType.Attachment] },
      validator: { required: false },
    },
    {
      key: 'videoField',
      label: t('video_label'),
      component: FieldComponent.FieldSelect,
      props: { supportType: [FieldType.Attachment] },
      validator: { required: false },
    },
    {
      key: 'audioField',
      label: t('audio_label'),
      component: FieldComponent.FieldSelect,
      props: { supportType: [FieldType.Attachment] },
      validator: { required: false },
    },
    {
      key: 'model',
      label: t('model_label'),
      component: FieldComponent.SingleSelect,
      props: { options: MODEL_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
      validator: { required: false },
    },
    {
      key: 'resolution',
      label: t('resolution_label'),
      component: FieldComponent.SingleSelect,
      props: { options: RESOLUTION_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
      validator: { required: false },
    },
    {
      key: 'ratio',
      label: t('ratio_label'),
      component: FieldComponent.SingleSelect,
      props: { options: RATIO_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
      validator: { required: false },
    },
    {
      key: 'duration',
      label: t('duration_label'),
      component: FieldComponent.SingleSelect,
      props: { options: DURATION_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
      validator: { required: false },
    },
    {
      key: 'generateAudio',
      label: t('generate_audio_label'),
      component: FieldComponent.SingleSelect,
      props: { options: GENERATE_AUDIO_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
      validator: { required: false },
    },
    {
      key: 'returnLastFrame',
      label: t('return_last_frame_label'),
      component: FieldComponent.SingleSelect,
      props: { options: RETURN_LAST_FRAME_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
      validator: { required: false },
    },
    {
      key: 'watermark',
      label: t('watermark_label'),
      component: FieldComponent.SingleSelect,
      props: { options: WATERMARK_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
      validator: { required: false },
    },
    {
      key: 'cameraFixed',
      label: t('camera_fixed_label'),
      component: FieldComponent.SingleSelect,
      props: { options: CAMERA_FIXED_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
      validator: { required: false },
    },
    {
      key: 'serviceTier',
      label: t('service_tier_label'),
      component: FieldComponent.SingleSelect,
      props: { options: SERVICE_TIER_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
      validator: { required: false },
    },
    {
      key: 'seed',
      label: t('seed_label'),
      component: FieldComponent.Input,
      props: { placeholder: t('seed_placeholder') },
      validator: { required: false },
    },
  ],
  resultType: {
    type: FieldType.Text,
  },
  execute: async (params: { [key: string]: any }, context: any) => {
    const formItemParams = params as unknown as FormItemParams;
    const log = (arg: any, showContext = false) => debugLog(arg, context, showContext);
    log('===== Seedance 2.0 开始执行 =====', true);

    const emptyResult = { code: FieldCode.Success as const, data: null };

    const isNeedPayPack = context?.isNeedPayPack === true;
    const hasQuota = context?.hasQuota === true;
    if (isNeedPayPack && !hasQuota) {
      return { code: FieldCode.Success as const, data: '⚠️ 请先购买会员包后再使用' };
    }

    const safeFetch = createSafeFetch(context, log);
    const rawFetch = context.fetch;

    try {
      // 参数归一化
      const normalized: FormItemParams = { ...formItemParams };

      normalized.model = normalizeSelect(normalized.model) || DEFAULT_MODEL;
      normalized.resolution = normalizeSelect(normalized.resolution) || DEFAULT_RESOLUTION;
      normalized.ratio = normalizeSelect(normalized.ratio) || DEFAULT_RATIO;
      normalized.duration = normalizeSelect(normalized.duration) || DEFAULT_DURATION;
      normalized.generateAudio = normalizeSelect(normalized.generateAudio) === 'true';
      normalized.returnLastFrame = normalizeSelect(normalized.returnLastFrame) === 'true';
      normalized.watermark = normalizeSelect(normalized.watermark) === 'true';
      normalized.cameraFixed = normalizeSelect(normalized.cameraFixed) === 'true';
      normalized.serviceTier = normalizeSelect(normalized.serviceTier) || DEFAULT_SERVICE_TIER;

      const promptText = parsePromptText(normalized.prompt);
      if (!promptText.trim()) {
        log({ skip: true, reason: 'prompt为空，跳过执行' });
        return emptyResult;
      }
      normalized.prompt = promptText;

      log({
        params: {
          model: normalized.model,
          resolution: normalized.resolution,
          ratio: normalized.ratio,
          duration: normalized.duration,
          generateAudio: normalized.generateAudio,
          returnLastFrame: normalized.returnLastFrame,
          promptLength: promptText.length,
        },
      });

      const validationError = validateParams(normalized);
      if (validationError) {
        log({ validationError });
        return { code: FieldCode.Success as const, data: `❌ 参数校验失败: ${validationError}` };
      }

      const { taskId, error: createError, warnings } = await createVideoTask(
        normalized, safeFetch, rawFetch, log,
      );
      if (createError || !taskId) {
        log({ createError, taskId });
        return { code: FieldCode.Success as const, data: `❌ 生成失败: ${createError || '未知错误'}` };
      }

      log({ taskId, msg: '任务创建成功，开始轮询' });

      const result = await pollTask(taskId, normalized.apiKey, safeFetch, log);

      if (!result) {
        return {
          code: FieldCode.Success as const,
          data: `⏱️ 轮询超时: 任务 ${taskId} 未在规定时间内完成，请在火山引擎控制台查看`,
        };
      }

      if (result.status === 'succeeded') {
        const videoUrl = result.content?.video_url || '';
        const lastFrameUrl = result.content?.last_frame_url || '';
        const tokens = result.usage?.completion_tokens || 0;

        log({
          succeeded: true,
          videoUrl: videoUrl.slice(0, 200),
          lastFrameUrl: lastFrameUrl.slice(0, 200),
          tokens,
        });

        return {
          code: FieldCode.Success as const,
          data: formatResult(videoUrl, lastFrameUrl, tokens, String(result.duration ?? normalized.duration), result.seed, warnings),
        };
      }

      const failReason = result.error?.message || result.error || result.status;
      log({ taskFailed: true, status: result.status, error: result.error });
      return {
        code: FieldCode.Success as const,
        data: `❌ 任务失败 [${result.status}]: ${typeof failReason === 'string' ? failReason : JSON.stringify(failReason)}`,
      };
    } catch (e) {
      log({ '===异常错误': String(e), stack: (e as Error)?.stack?.slice(0, 500) });
      return { code: FieldCode.Success as const, data: `❌ 内部错误: ${String(e).slice(0, 200)}` };
    }
  },
});

export default basekit;
