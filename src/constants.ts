export const SEEDANCE_API_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
export const SEEDANCE_CREATE_TASK_URL = `${SEEDANCE_API_BASE}/contents/generations/tasks`;
export const SEEDANCE_QUERY_TASK_URL_PREFIX = `${SEEDANCE_API_BASE}/contents/generations/tasks/`;

export const POLL_INTERVAL_MS = 10000;
export const MAX_POLL_COUNT = 120;

export const SUPPORTED_MODELS = {
  SEEDANCE_2_0: 'doubao-seedance-2-0-260128',
  SEEDANCE_2_0_FAST: 'doubao-seedance-2-0-fast-260128',
} as const;

export const MODEL_OPTIONS = [
  { label: 'Seedance 2.0（标准）', value: SUPPORTED_MODELS.SEEDANCE_2_0 },
  { label: 'Seedance 2.0 Fast（极速）', value: SUPPORTED_MODELS.SEEDANCE_2_0_FAST },
] as const;

export const RESOLUTION_OPTIONS = [
  { label: '480p', value: '480p' },
  { label: '720p', value: '720p' },
  { label: '1080p（默认）', value: '1080p' },
  { label: '2K', value: '2K' },
] as const;

export const RATIO_OPTIONS = [
  { label: '16:9（默认）', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9', value: '21:9' },
  { label: '1:1', value: '1:1' },
  { label: 'adaptive（跟随图片）', value: 'adaptive' },
] as const;

export const DURATION_OPTIONS = [
  { label: '4秒', value: '4' },
  { label: '5秒（默认）', value: '5' },
  { label: '6秒', value: '6' },
  { label: '8秒', value: '8' },
  { label: '10秒', value: '10' },
  { label: '12秒', value: '12' },
  { label: '15秒', value: '15' },
] as const;

export const GENERATE_AUDIO_OPTIONS = [
  { label: '不生成音频', value: 'false' },
  { label: '生成原生音频', value: 'true' },
] as const;

export const RETURN_LAST_FRAME_OPTIONS = [
  { label: '不返回尾帧', value: 'false' },
  { label: '返回尾帧（续接视频用）', value: 'true' },
] as const;

export const WATERMARK_OPTIONS = [
  { label: '无水印（默认）', value: 'false' },
  { label: '有水印', value: 'true' },
] as const;

export const CAMERA_FIXED_OPTIONS = [
  { label: '不固定（默认）', value: 'false' },
  { label: '固定摄像头', value: 'true' },
] as const;

export const SERVICE_TIER_OPTIONS = [
  { label: 'default（在线推理）', value: 'default' },
  { label: 'flex（离线推理，约半价）', value: 'flex' },
] as const;

export const TERMINAL_STATUSES = ['failed', 'expired', 'cancelled'] as const;

export const LITTERBOX_UPLOAD_URL = 'https://litterbox.catbox.moe/resources/internals/api.php';
export const LITTERBOX_EXPIRY = '72h';

export const DEFAULT_MODEL = SUPPORTED_MODELS.SEEDANCE_2_0;
export const DEFAULT_RESOLUTION = '1080p';
export const DEFAULT_RATIO = '16:9';
export const DEFAULT_DURATION = '5';
export const DEFAULT_SERVICE_TIER = 'default';

export const DOMAIN_WHITELIST = [
  'ark.cn-beijing.volces.com',
  'internal-api-drive-stream.feishu.cn',
  'litterbox.catbox.moe',
];
