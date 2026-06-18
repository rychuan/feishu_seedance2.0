import { POLL_INTERVAL_MS, MAX_POLL_COUNT, TERMINAL_STATUSES, SEEDANCE_QUERY_TASK_URL_PREFIX } from '../constants';
import { SeedanceQueryResponse } from '../types';
import { SafeFetchFn } from './fetch';

const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_UNRECOGNIZED_STATUS_COUNT = 10;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDynamicInterval(index: number): number {
  if (index < 30) return POLL_INTERVAL_MS;
  if (index < 60) return 15000;
  return 20000;
}

export async function pollTask(
  taskId: string,
  apiKey: string,
  safeFetch: SafeFetchFn,
  debugLog: (arg: any, showContext?: boolean) => void
): Promise<SeedanceQueryResponse | null> {
  let consecutiveFailures = 0;
  let lastUnrecognizedStatus = '';
  let unrecognizedCount = 0;

  for (let i = 0; i < MAX_POLL_COUNT; i++) {
    await sleep(getDynamicInterval(i));

    const queryRes = await safeFetch<SeedanceQueryResponse>(
      `${SEEDANCE_QUERY_TASK_URL_PREFIX}${taskId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );

    if (queryRes && typeof queryRes === 'object' && 'code' in queryRes && queryRes.code === -1) {
      consecutiveFailures++;
      debugLog({ pollError: '查询失败', taskId, index: i, consecutiveFailures });
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        debugLog({ pollAbort: '连续失败过多，终止轮询', taskId, consecutiveFailures });
        return null;
      }
      continue;
    }

    consecutiveFailures = 0;

    const status = (queryRes as SeedanceQueryResponse)?.status;
    debugLog({ pollIndex: i, status, taskId });

   if (status === 'succeeded' || TERMINAL_STATUSES.includes(status as any)) {
     return queryRes as SeedanceQueryResponse;
   }

    if (!['queued', 'processing', 'succeeded', ...TERMINAL_STATUSES].includes(status)) {
      if (status === lastUnrecognizedStatus) {
        unrecognizedCount++;
      } else {
        lastUnrecognizedStatus = status;
        unrecognizedCount = 1;
      }
      debugLog({ pollWarning: '未识别的任务状态', status, unrecognizedCount, taskId });
      if (unrecognizedCount >= MAX_UNRECOGNIZED_STATUS_COUNT) {
        debugLog({ pollAbort: '未识别状态持续过久，终止轮询', status, unrecognizedCount, taskId });
        return queryRes as SeedanceQueryResponse;
      }
    } else {
      unrecognizedCount = 0;
    }
  }

  return null;
}
