export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchError {
  code: number;
  error: string;
}

export type SafeFetchFn = <T = any>(
  url: string,
  init: FetchInit,
  authId?: string
) => Promise<T | FetchError>;

function redactSensitive(text: string): string {
  return text.replace(/Bearer\s+[^\s"']+/g, 'Bearer [REDACTED]')
    .replace(/(?:api[_-]?key|token|secret)["\s:=]+[\w\-]{10,}/gi, '[REDACTED]');
}

export function createSafeFetch(
  context: any,
  debugLog: (arg: any, showContext?: boolean) => void
): SafeFetchFn {
  return async function safeFetch<T = any>(
    url: string,
    init: FetchInit,
    authId?: string
  ): Promise<T | FetchError> {
    try {
      const res = await context.fetch(url, init, authId);
      const resText = await res.text();
      const statusCode = res?.status;

      debugLog({
        [`===fetch res: ${url.slice(0, 100)}`]: {
          status: statusCode,
          resText: redactSensitive(resText).slice(0, 500),
        },
      });

      if (statusCode && statusCode >= 400) {
        const redacted = redactSensitive(resText);
        return { code: -1, error: `HTTP ${statusCode}: ${redacted.slice(0, 200)}` };
      }

      try {
        return JSON.parse(resText);
      } catch (parseErr) {
        return { code: -1, error: `非JSON响应 (HTTP ${statusCode || '未知'}): ${resText.slice(0, 200)}` };
      }
    } catch (e) {
      debugLog({ [`===fetch error: ${url.slice(0, 100)}`]: { error: String(e) } });
      return { code: -1, error: String(e) };
    }
  };
}

export function sanitizeForOutput(text: string): string {
  return redactSensitive(text);
}
