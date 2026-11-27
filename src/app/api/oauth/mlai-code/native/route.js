import { randomBytes } from 'node:crypto';
import { startMlaiLogin } from '@/lib/oauth/services/mlai-native.js';
import { createProviderConnection } from '@/models';

export const runtime = 'nodejs';
const sessions = new Map();
export async function POST(request) {
 let body;
 try { body = await request.json(); } catch { return Response.json({error:'Invalid request'},{status:400}); }
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
 if (body.action !== 'status') return Response.json({error:'Unknown action'},{status:400});
 const status = entry.login.status();
 if (status.status !== 'pending') sessions.delete(body.session);
 return Response.json(status,{headers:{'Cache-Control':'no-store'}});
}
