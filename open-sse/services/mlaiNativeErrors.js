// Never expose upstream body text. Read at most 8 KiB and wait at most one second.
export class MlaiNativeError extends Error {
 constructor(status, message, code, retryAfter) { super(message); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}
export const RUN_CLOSED_MESSAGE = 'ML AI native run has ended. Explicit user action to start a new run is required; this request was not replayed.';
export async function classifyMlaiNativeError(response) {
 let text = '', reader, timer;
 try {
  reader = response.body?.getReader();
  if (reader) {
   const bytes = await Promise.race([
    (async () => {
     const chunks = []; let size = 0;
     while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) return null;
      chunks.push(value);
     }
     const all = new Uint8Array(size); let offset = 0;
     for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
     return all;
    })(),
    new Promise(resolve => { timer = setTimeout(() => resolve(null), 1000); }),
   ]);
   if (bytes) text = new TextDecoder().decode(bytes);
  }
 } catch { /* Malformed/stalled bodies are an unknown error, not closure evidence. */ }
 finally { clearTimeout(timer); if (reader) { void reader.cancel().catch(() => {}); } }
 let code, message;
 try { const value = JSON.parse(text); code = value?.error?.code ?? value?.code; message = value?.error?.message ?? value?.message; } catch { /* Unknown format. */ }
 const closed = response.status === 409 && (code === 'run_finished' || message === 'This run has ended');
 const category = closed ? 'run_closed' : ({401:'authentication_required',402:'billing_required',403:'access_denied',429:'rate_limited'}[response.status] || 'upstream_error');
 return { code: category, renewable: response.status===409 && code==='run_finished', message: closed ? RUN_CLOSED_MESSAGE : 'ML AI native upstream HTTP ' + response.status };
}
