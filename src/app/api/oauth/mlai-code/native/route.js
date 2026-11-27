import { randomBytes } from 'node:crypto';
import { startMlaiLogin } from '@/lib/oauth/services/mlai-native.js';
import { createProviderConnection } from '@/models';

export const runtime = 'nodejs';
const sessions = new Map();
function allowedOrigin(request) {
 // Only server configuration may describe the reverse proxy's public origin.
 // An explicitly invalid setting must fail closed, not fall back to request data.
 const configured = process.env.MLAI_NATIVE_PUBLIC_ORIGIN || process.env.BASE_URL;
 try {
  const url = new URL(configured || request.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (configured && (url.pathname !== '/' || url.search || url.hash)) return null;
  return url.origin;
 } catch { return null; }
}
export async function POST(request) {
 // Dashboard authentication remains enforced by dashboardGuard (/api/oauth).
 // Do not trust forwarded headers supplied by callers to relax this boundary.
 const origin = request.headers.get('origin');
 const expectedOrigin = allowedOrigin(request);
 if (!expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== expectedOrigin)) return Response.json({error:'Invalid request origin'},{status:403});
 if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return Response.json({error:'JSON required'},{status:415});
 let body;
 try { body = await request.json(); } catch { return Response.json({error:'Invalid request'},{status:400}); }
 if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({error:'Invalid request'},{status:400});
 for (const [key, value] of sessions) if (value.expires < Date.now()) { value.login.cancel(); sessions.delete(key); }
 if (body.action === 'start') {
  if (sessions.size >= 8) return Response.json({error:'Too many pending native logins'},{status:429});
  try {
   const login = await startMlaiLogin({saveConnection:createProviderConnection});
   const session = randomBytes(32).toString('base64url');
   sessions.set(session,{login,expires:Date.now()+240000});
   return Response.json({session,authorizeUrl:login.authorizeUrl},{headers:{'Cache-Control':'no-store'}});
  } catch { return Response.json({error:'Cannot start ML AI loopback login'},{status:500}); }
 }
 const entry = sessions.get(body.session);
 if (!entry) return Response.json({error:'Native login session expired'},{status:404});
 if (body.action === 'cancel') { entry.login.cancel(); sessions.delete(body.session); return Response.json({status:'cancelled'}); }
 if (body.action === 'callback') {
  if (typeof body.callbackUrl !== 'string' || body.callbackUrl.length > 4096) return Response.json({error:'Invalid sign-in callback'},{status:400});
  try { return Response.json(await entry.login.submitCallback(body.callbackUrl),{headers:{'Cache-Control':'no-store'}}); }
  catch { return Response.json({error:'Invalid or already used sign-in callback'},{status:400,headers:{'Cache-Control':'no-store'}}); }
 }
 if (body.action !== 'status') return Response.json({error:'Unknown action'},{status:400});
 const status = entry.login.status();
 // Retain sanitized terminal results until expiry: manual completion and polling may race.
 return Response.json(status,{headers:{'Cache-Control':'no-store'}});
}
