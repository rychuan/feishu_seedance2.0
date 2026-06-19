export interface Attachment {
  tmp_url?: string;
  url?: string;
  name?: string;
  type?: string;
  mimeType?: string;
}

export interface FormItemParams {
  apiKey: string;
  prompt: any;
  imageField: any[];
  imageField2?: any[];
  videoField: any[];
  audioField: any[];
  model: string;
  resolution: string;
  ratio: string;
  duration: string;
  generateAudio: boolean;
  returnLastFrame: boolean;
  watermark: boolean;
  cameraFixed: boolean;
  serviceTier: string;
  seed: string;
}

export interface SeedanceCreateResponse {
  id: string;
  status?: string;
  model?: string;
}

export interface SeedanceQueryResponse {
  id: string;
  model?: string;
  status: string;
  error?: any;
  created_at?: number;
  updated_at?: number;
  content?: {
    video_url: string;
    last_frame_url?: string;
    file_url?: string;
  };
  usage?: {
    completion_tokens: number;
    total_tokens?: number;
  };
  seed?: number;
  resolution?: string;
  ratio?: string;
  duration?: number;
  frames?: number;
  framespersecond?: number;
  generate_audio?: boolean;
  service_tier?: string;
}

export interface SeedanceContentItem {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url';
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
  role?: string;
}

export interface TaskResult {
  taskId: string | null;
  error: string | null;
  warnings: string[];
}
