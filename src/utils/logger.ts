export function debugLog(arg: any, context?: any, showContext: boolean = false): void {
  try {
    if (typeof arg === 'string') {
      console.log(arg);
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
