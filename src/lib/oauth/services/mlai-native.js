import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { proxyAwareFetch } from 'open-sse/utils/proxyFetch.js';

// Official mlai-code@0.3.32 login contract, inspected in the distributed CLI.
// Device tokens are not OAuth refresh tokens: expiry/revocation requires a new login.
export async function startMlaiLogin({ fetchImpl = proxyAwareFetch, saveConnection, timeoutMs = 180000 } = {}) {
 const verifier = randomBytes(32).toString('base64url');
 const state = randomBytes(24).toString('base64url');
 const challenge = createHash('sha256').update(verifier).digest('base64url');
 let status = { status: 'pending' }, completing = false, timer;
 const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
 const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const candidate = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const reply = (code, text) => { response.writeHead(code, headers); response.end(text); };
  if (request.method !== 'GET' || url.pathname !== '/callback' || request.headers.host !== `127.0.0.1:${server.address()?.port}` || !/^[A-Za-z0-9_-]{32}$/.test(candidate) || !timingSafeEqual(Buffer.from(candidate), Buffer.from(state))) return reply(400, 'Invalid sign-in callback');
  if (completing || status.status !== 'pending') return reply(409, 'Sign-in is already completing');
  if (url.searchParams.get('error') === 'access_denied' && !code) {
   status = { status: 'error', error: 'Sign-in cancelled' }; response.on('finish', close); return reply(200, 'Sign-in cancelled. Return to 9router.');
  }
  if (url.searchParams.has('error') || code.length < 50 || code.length > 3500) return reply(400, 'Invalid sign-in callback');
  completing = true;
  try {
   const upstream = await fetchImpl('https://code.ml.ai/api/clients', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-MLAI-Client': 'laptop', 'X-MLAI-Version': '0.3.32', 'X-MLAI-Protocol': '1' }, body: JSON.stringify({ action: 'exchange', code, verifier }), signal: AbortSignal.timeout(30000) });
   if (!upstream.ok) { await upstream.body?.cancel(); throw new Error('Sign-in exchange failed'); }
   const value = await upstream.json();
   if (typeof value.token !== 'string' || !value.token.startsWith('mlaid_') || !Number.isFinite(value.expires) || value.expires <= Date.now() || value.surface !== 'laptop') throw new Error('Invalid sign-in response');
   if (status.status !== 'pending') throw new Error('Sign-in cancelled');
   const connection = await saveConnection({ provider: 'mlai-code', authType: 'oauth', accessToken: value.token, expiresAt: new Date(value.expires).toISOString(), name: 'ML AI native device', providerSpecificData: { mlaiNative: true }, testStatus: 'active' });
   status = { status: 'done', connection: { id: connection.id } };
   response.on('finish', close); reply(200, 'ML AI native login connected. Return to 9router.');
  } catch {
   status = { status: 'error', error: 'ML AI sign-in could not finish; restart native login' };
   response.on('finish', close); reply(400, status.error);
  }
 });
 function close() { clearTimeout(timer); server.close(); server.closeAllConnections?.(); }
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
 timer = setTimeout(() => { status = { status: 'error', error: 'ML AI sign-in expired; restart native login' }; close(); }, timeoutMs);
 timer.unref?.();
 const auth = new URL('https://code.ml.ai/clients/auth');
 for (const [key, value] of Object.entries({ port: String(server.address().port), state, challenge, surface: 'laptop', label: '9router native device' })) auth.searchParams.set(key, value);
 return { authorizeUrl: auth.toString(), status: () => ({ ...status }), cancel: () => { if (status.status === 'pending') status = { status: 'error', error: 'Sign-in cancelled' }; close(); } };
}
