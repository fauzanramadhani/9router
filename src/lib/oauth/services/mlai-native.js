import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { proxyAwareFetch } from 'open-sse/utils/proxyFetch.js';

// Official mlai-code@0.3.32 login contract, inspected in the distributed CLI.
// Device tokens are not OAuth refresh tokens: expiry/revocation requires a new login.
export async function startMlaiLogin({ fetchImpl = proxyAwareFetch, saveConnection, timeoutMs = 180000 } = {}) {
 const verifier = randomBytes(32).toString('base64url');
 const state = randomBytes(24).toString('base64url');
 const challenge = createHash('sha256').update(verifier).digest('base64url');
 let status = { status: 'pending' }, completing = false, committing = false, timer, port;
 const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
 async function complete(raw) {
  if (typeof raw !== 'string' || raw.length > 4096 || !raw.startsWith(`http://127.0.0.1:${port}/callback?`) || /[\s\\#]/.test(raw)) throw new Error('Invalid sign-in callback');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid sign-in callback'); }
  const keys = [...url.searchParams.keys()];
  if (keys.some(key => !['code', 'state', 'error'].includes(key)) || new Set(keys).size !== keys.length || url.username || url.password || url.hash) throw new Error('Invalid sign-in callback');
  const candidate = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (url.protocol !== 'http:' || url.host !== `127.0.0.1:${port}` || url.pathname !== '/callback' || !/^[A-Za-z0-9_-]{32}$/.test(candidate) || !timingSafeEqual(Buffer.from(candidate), Buffer.from(state))) throw new Error('Invalid sign-in callback');
  if (completing || status.status !== 'pending') throw new Error('Sign-in is already completing');
  if (url.searchParams.get('error') === 'access_denied' && !url.searchParams.has('code')) {
   status = { status: 'error', error: 'Sign-in cancelled' }; return { ...status };
  }
  if (url.searchParams.has('error') || code.length < 50 || code.length > 3500) throw new Error('Invalid sign-in callback');
  completing = true;
  try {
   const upstream = await fetchImpl('https://code.ml.ai/api/clients', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-MLAI-Client': 'laptop', 'X-MLAI-Version': '0.3.32', 'X-MLAI-Protocol': '1' }, body: JSON.stringify({ action: 'exchange', code, verifier }), signal: AbortSignal.timeout(30000) });
   if (!upstream.ok) { await upstream.body?.cancel(); throw new Error('Sign-in exchange failed'); }
   const value = await upstream.json();
   if (typeof value.token !== 'string' || !value.token.startsWith('mlaid_') || !Number.isFinite(value.expires) || value.expires <= Date.now() || value.surface !== 'laptop') throw new Error('Invalid sign-in response');
   if (status.status !== 'pending') throw new Error('Sign-in cancelled');
   // Persistence is the commit point: cancellation wins before it, never mid-write.
   committing = true;
   clearTimeout(timer);
   const connection = await saveConnection({ provider: 'mlai-code', authType: 'oauth', accessToken: value.token, expiresAt: new Date(value.expires).toISOString(), name: 'ML AI native device', providerSpecificData: { mlaiNative: true }, testStatus: 'active' });
   status = { status: 'done', connection: { id: connection.id } };

  } catch {
   if (status.status === 'pending') status = { status: 'error', error: 'ML AI sign-in could not finish; restart native login' };

  }
  return { ...status };
 }
 const server = http.createServer(async (request, response) => {
  const reply = (code, text) => { response.writeHead(code, headers); response.end(text); };
  if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${port}`) return reply(400, 'Invalid sign-in callback');
  try {
   const result = await complete(`http://127.0.0.1:${port}${request.url}`);
   response.on('finish', close);
   reply(result.status === 'done' || result.error === 'Sign-in cancelled' ? 200 : 400, result.status === 'done' ? 'ML AI native login connected. Return to 9router.' : result.error);
  } catch { reply(400, 'Invalid sign-in callback'); }
 });
 function close() { clearTimeout(timer); server.close(); server.closeAllConnections?.(); }
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
 port = server.address().port;
 timer = setTimeout(() => { if (committing || status.status !== 'pending') return; status = { status: 'error', error: 'ML AI sign-in expired; restart native login' }; close(); }, timeoutMs);
 timer.unref?.();
 const auth = new URL('https://code.ml.ai/clients/auth');
 for (const [key, value] of Object.entries({ port: String(server.address().port), state, challenge, surface: 'laptop', label: '9router native device' })) auth.searchParams.set(key, value);
 return { authorizeUrl: auth.toString(), status: () => ({ ...status }), submitCallback: async value => {
  const result = await complete(value);
  close();
  return result;
 }, cancel: () => { if (status.status === 'pending' && !committing) status = { status: 'error', error: 'Sign-in cancelled' }; close(); } };
}
