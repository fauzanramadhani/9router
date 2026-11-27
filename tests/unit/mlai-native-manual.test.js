import {it,expect,vi} from 'vitest';
import {startMlaiLogin} from '../../src/lib/oauth/services/mlai-native.js';
const callback=login=>{const auth=new URL(login.authorizeUrl);return `http://127.0.0.1:${auth.searchParams.get('port')}/callback?state=${auth.searchParams.get('state')}&code=${'c'.repeat(60)}`;};
it.each([
 ['duplicate code',u=>u+'&code=other'],['duplicate state',u=>u+'&state=other'],
 ['credentials',u=>u.replace('http://','http://user:pass@')],['fragment',u=>u+'#secret'],
 ['code and error',u=>u+'&error=access_denied'],['empty code with denial',u=>u.replace(/code=.*/, 'code=&error=access_denied')],
 ['duplicate denial',u=>u.replace(/code=.*/, 'error=access_denied&error=access_denied')],
 ['unknown parameter',u=>u+'&redirect_uri=https://evil.test'],
 ['alternate numeric host',u=>u.replace('127.0.0.1','2130706433')],
 ['normalized path',u=>u.replace('/callback','/a/../callback')],
 ['short code',u=>u.replace(/code=.*/, 'code=short')],['long code',u=>u.replace(/code=.*/, 'code='+'c'.repeat(3501))],
 ['localhost',u=>u.replace('127.0.0.1','localhost')],['https',u=>u.replace('http:', 'https:')],
 ['wrong port',u=>u.replace(/:\d+\//,':1/')],['wrong state',u=>u.replace(/state=[^&]+/,'state='+'x'.repeat(32))],
])('rejects %s without exchange or consuming the pending session',async(_name,mutate)=>{
 const exchange=vi.fn();const save=vi.fn();const login=await startMlaiLogin({fetchImpl:exchange,saveConnection:save});
 try{await expect(login.submitCallback(mutate(callback(login)))).rejects.toThrow('Invalid sign-in callback');expect(login.status()).toEqual({status:'pending'});expect(exchange).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();}finally{login.cancel();}
});
it.each(['cancel','expire'])('preserves %s while a remote exchange is in flight and never persists',async(mode)=>{
 let release,entered;const ready=new Promise(r=>entered=r);const pending=new Promise(r=>release=r);
 const save=vi.fn();const exchange=vi.fn(()=>{entered();return pending;});
 const login=await startMlaiLogin({fetchImpl:exchange,saveConnection:save,timeoutMs:mode==='expire'?20:10000});
 try{
  const first=login.submitCallback(callback(login));await ready;
  await expect(login.submitCallback(callback(login))).rejects.toThrow('already completing');
  if(mode==='cancel')login.cancel();else await new Promise(r=>setTimeout(r,40));
  const terminal=login.status();release(Response.json({token:'mlaid_race',expires:Date.now()+60000,surface:'laptop'}));
  expect(await first).toEqual(terminal);expect(save).not.toHaveBeenCalled();expect(exchange).toHaveBeenCalledTimes(1);
 }finally{login.cancel();}
});
it('shares one exchange with the automatic local listener',async()=>{
 let release,entered;const ready=new Promise(r=>entered=r);const pending=new Promise(r=>release=r);
 const exchange=vi.fn(()=>{entered();return pending;});const save=vi.fn(async()=>({id:'local'}));
 const login=await startMlaiLogin({fetchImpl:exchange,saveConnection:save});
 try{const local=fetch(callback(login));await ready;await expect(login.submitCallback(callback(login))).rejects.toThrow('already completing');release(Response.json({token:'mlaid_race',expires:Date.now()+60000,surface:'laptop'}));expect((await local).status).toBe(200);expect(save).toHaveBeenCalledTimes(1);expect(exchange).toHaveBeenCalledTimes(1);}finally{login.cancel();}
});
it('commits persistence once without a late cancellation overwriting success',async()=>{
 let release,entered;const ready=new Promise(r=>entered=r);const pending=new Promise(r=>release=r);
 const login=await startMlaiLogin({fetchImpl:async()=>Response.json({token:'mlaid_race',expires:Date.now()+60000,surface:'laptop'}),saveConnection:()=>{entered();return pending;},timeoutMs:20});
 try{const first=login.submitCallback(callback(login));await ready;login.cancel();await new Promise(r=>setTimeout(r,40));expect(login.status()).toEqual({status:'pending'});release({id:'committed'});expect(await first).toEqual({status:'done',connection:{id:'committed'}});}finally{login.cancel();}
});
it('accepts only a state-matched denial without exchanging',async()=>{
 const exchange=vi.fn();const login=await startMlaiLogin({fetchImpl:exchange,saveConnection:vi.fn()});
 try{expect(await login.submitCallback(callback(login).replace(/code=.*/,'error=access_denied'))).toEqual({status:'error',error:'Sign-in cancelled'});expect(exchange).not.toHaveBeenCalled();}finally{login.cancel();}
});
it('completes a pasted remote callback using only the server-owned exchange and verifier',async()=>{
 const exchange=vi.fn(async()=>Response.json({token:'mlaid_synthetic',expires:Date.now()+60000,surface:'laptop'}));
 const save=vi.fn(async()=>({id:'manual'}));
 const login=await startMlaiLogin({fetchImpl:exchange,saveConnection:save});
 try {
  expect(await login.submitCallback(callback(login))).toEqual({status:'done',connection:{id:'manual'}});
  expect(exchange).toHaveBeenCalledTimes(1);
  expect(exchange.mock.calls[0][0]).toBe('https://code.ml.ai/api/clients');
  expect(JSON.parse(exchange.mock.calls[0][1].body).verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(save).toHaveBeenCalledTimes(1);
  expect(Object.keys(login).sort()).toEqual(['authorizeUrl','cancel','status','submitCallback']);
 }finally{login.cancel();}
});
