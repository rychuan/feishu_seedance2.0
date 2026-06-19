export function debugLog(arg: any, context?: any, showContext: boolean = false): void {
  try {
    if (typeof arg === 'string') {
      console.log(arg);
    } else if (arg instanceof Error) {
      console.log(JSON.stringify({ error: arg.message, stack: arg.stack?.slice(0, 2000) ?? '(no stack)' }));
    } else {
      const logObj = { ...arg };
      if (showContext && context) {
        logObj['_context'] = {
          isNeedPayPack: context?.isNeedPayPack,
          hasQuota: context?.hasQuota,
        };
      }
      console.log(JSON.stringify(logObj, null, 2));
    }
  } catch (e) {
    console.log(String(arg));
  }
}
