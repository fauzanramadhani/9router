import { describe,it,expect,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import entry from '../../open-sse/providers/registry/mlai-code.js';
import { translateRequest } from '../../open-sse/translator/index.js';
describe('ML AI native dashboard/router integration',()=>{
 it('offers only native OAuth device login',()=>{
  expect(entry.authModes).toEqual(['oauth']);
  expect(entry.models.some(m=>m.id==='main')).toBe(true);
  const page=readFileSync('src/app/(dashboard)/dashboard/providers/[id]/page.js','utf8');
  expect(page).toContain('<MlaiNativeAuthModal');
  expect(page).toContain('Native Device Login');
  expect(page).not.toContain('Legacy Agent API Key');
  const core=readFileSync('open-sse/handlers/chatCore.js','utf8');
  expect(core).toContain('!mlaiNative && Array.isArray(translatedBody.tools)');
  expect(core).toContain('!passthrough && !mlaiNative');
  expect(core).toContain('!executor.noAuth && !mlaiNative');
 });
 it('offers the remote callback submission on the existing private native session',()=>{
  const modal=readFileSync('src/shared/components/MlaiNativeAuthModal.js','utf8');
  expect(modal).toContain('Paste callback URL');
  expect(modal).toContain("action:'callback',session,callbackUrl");
  expect(modal).toContain('ERR_CONNECTION_REFUSED');
  expect(modal).not.toContain('remote dashboards require a secure local port tunnel');
  expect(modal).not.toContain('codeVerifier');
 });
 it('preserves complete native OpenAI body rather than applying cloud text normalization',()=>{
  const body={messages:[{role:'user',content:[{type:'image_url',image_url:{url:'https://example.test/image'}}]}],tools:[{type:'function',function:{name:'x',strict:true,parameters:{type:'object',additionalProperties:false}}}],response_format:{type:'json_object'}};
  expect(translateRequest('openai','openai','main',body,true,{providerSpecificData:{mlaiNative:true}},'mlai-code')).toEqual({...body,model:'main',stream:true});
 });
});
