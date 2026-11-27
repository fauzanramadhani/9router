import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { startMlaiLogin } from '../../src/lib/oauth/services/mlai-native.js';

describe('official ML AI device PKCE login', () => {
 it('does not persist a login cancelled while exchange is in flight',async()=>{
  let release,entered;
  const ready=new Promise(r=>entered=r);
  const pending=new Promise(r=>release=r);
  const save=vi.fn();
  const login=await startMlaiLogin({saveConnection:save,fetchImpl:async()=>{entered();return pending;}});
  const auth=new URL(login.authorizeUrl);
  const callback=fetch(`http://127.0.0.1:${auth.searchParams.get('port')}/callback?state=${auth.searchParams.get('state')}&code=${'c'.repeat(60)}`).catch(()=>null);
  await ready;login.cancel();release(Response.json({token:'mlaid_cancelled',expires:Date.now()+3600000,surface:'laptop'}));
  await callback;await new Promise(r=>setTimeout(r,20));
  expect(save).not.toHaveBeenCalled();expect(login.status().status).toBe('error');
 });
 it('binds official loopback callback, exchanges once server-side and never exposes credentials in status', async () => {
  const exchange=vi.fn(async (_url,options)=>{
   expect(options.redirect).toBe('error');
   expect(options.headers.Accept).toBe('application/json');
   const payload=JSON.parse(options.body);
   expect(payload.action).toBe('exchange');
   expect(payload.code).toBe('c'.repeat(60));
   expect(createHash('sha256').update(payload.verifier).digest('base64url')).toBe(auth.searchParams.get('challenge'));
   return Response.json({token:'mlaid_synthetic',expires:Date.now()+3600000,surface:'laptop'});
  });
  const save=vi.fn(async value=>{expect(value.accessToken).toBe('mlaid_synthetic');expect(value.providerSpecificData.mlaiNative).toBe(true);return {id:'saved-native'};});
  const login=await startMlaiLogin({fetchImpl:exchange,saveConnection:save});
  const auth=new URL(login.authorizeUrl);
  expect(auth.origin+auth.pathname).toBe('https://code.ml.ai/clients/auth');
  expect(auth.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(auth.searchParams.get('surface')).toBe('laptop');
  const callback=`http://127.0.0.1:${auth.searchParams.get('port')}/callback`;
  try {
   expect((await fetch(callback+'?state=wrong&code='+ 'c'.repeat(60))).status).toBe(400);
   expect(exchange).not.toHaveBeenCalled();
   const response=await fetch(callback+'?state='+auth.searchParams.get('state')+'&code='+'c'.repeat(60));
   expect(response.status).toBe(200);
   expect(save).toHaveBeenCalledTimes(1);
   expect(login.status()).toEqual({status:'done',connection:{id:'saved-native'}});
   expect(JSON.stringify(login.status())).not.toContain('mlaid_');
  } finally { login.cancel(); }
 });
});
