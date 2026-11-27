import {it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
it('removes obsolete cloud-agent services and their production references',()=>{
 for(const name of ['mlaiCode','mlaiCodeTools','mlaiCodeTransport','mlaiCodeConversationLease']) {
  expect(existsSync(`open-sse/services/${name}.js`)).toBe(false);
  for(const file of ['open-sse/executors/mlai-code.js','open-sse/handlers/chatCore.js','open-sse/translator/index.js','src/app/api/providers/validate/route.js','src/app/api/providers/[id]/test/testUtils.js']) expect(readFileSync(file,'utf8')).not.toContain(`${name}.js`);
 }
});
it('documents only native OAuth and the main public route',()=>{
 for(const file of ['docs/mlai-code.md','docs/mlai-native-router.md']) {
  const text=readFileSync(file,'utf8');expect(text).toContain('mlai/main');expect(text).not.toContain('Legacy Agent API Key');expect(text).not.toContain('mlai_sk');
 }
 expect(existsSync('docs/mlai-code-file-transport.md')).toBe(false);
});
