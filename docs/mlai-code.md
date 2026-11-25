# ML AI Code agent provider

Provider ID: `mlai-code`; model prefix alias: `mlai`.

Add **ML AI Code Agent** from the existing API-key provider screen using a `mlai_sk…` key. No cookies or OAuth are needed. New-key validation and saved-connection testing use a read-only authenticated `GET https://code.ml.ai/api/routines`; they do not start a job.

Models bundled from the upstream UI: `pixis-opus` (Opus 5.5R, default), `pixis` (Pixis), `pixis-sol` (GPT 6.1R Sol). All three returned real answers through the local 9router integration. Provider unit tests use mocked transport.

## Semantics and limits

This is an adapter to **undocumented internal agent APIs**, not a raw model inference API. A request starts a fresh remote job/workspace. The full text conversation is serialized as ordered JSON role/content entries in `task`. Job `completed` means workspace launch; the adapter then polls `/api/workspace` until `status.state` is `completed` and returns `status.result.submission`. It never returns the initial acknowledgement as the answer.

The existing OpenAI intermediary and client response conversions remain responsible for `/v1/chat/completions`, `/v1/messages`, and `/v1/responses`. The registry supplies models to the existing model catalogue. Raw-client preflight rejects unsupported data before intermediary translation can drop it.

- Text-only messages; no images, audio, files, client tools/tool results, structured output, or multiple choices. Unsupported requests return 400, not fabricated tool calls.
- Streaming is **buffered final-answer SSE**, not native token streaming. No content arrives until the agent completes.
- Defaults in the registry: 180-second total deadline, 180 total status polls, 1-second poll interval, 200,000-character serialized transcript limit, four agent steps.
- Client cancellation stops HTTP/polling promptly. No remote cancellation endpoint has been proven; an already launched remote agent may continue and incur usage after local cancellation or timeout.
- An empty/non-text submission fails with 502. Answer-event-only result variants are not currently supported because their schema has not been verified.
- Raw upstream errors are not echoed, and returned request metadata omits authorization/workspace credentials. Usage is mapped from upstream prompt/cached/completion fields when supplied; no estimates are invented.
- Sampling/token-budget parameters are not native inference controls for this upstream agent; its execution profile is fixed by registry job defaults.

## Implementation handoff

New files:
- `open-sse/providers/registry/mlai-code.js`
- `open-sse/executors/mlai-code.js`
- `open-sse/services/mlaiCode.js`
- `scripts/generate-registry-index.mjs`
- `tests/unit/mlai-code.test.js`
- `tests/unit/mlai-code-routes.test.js`
- `docs/mlai-code.md`

Modified:
- `open-sse/providers/registry/index.js` (generated)
- `open-sse/executors/index.js`
- `open-sse/handlers/chatCore.js` (provider-scoped raw-input preflight)
- `src/app/api/providers/validate/route.js`
- `src/app/api/providers/[id]/test/testUtils.js`
- `src/lib/providerNormalization.js`
- `src/shared/constants/providers.js`
- `src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js`

Registry regeneration: `node scripts/generate-registry-index.mjs`. The old migration/display-injection scripts do not provide a safe index-only operation; the new generator discovers new files while preserving existing order and intentionally hidden entries.

Verification:
- Strict red/green iterations exercised registration, polling/submission, SSE, unsupported input, failures, deadlines, cancellation and credential routes.
- `npm --prefix tests test -- unit/mlai-code.test.js unit/mlai-code-routes.test.js`: 42 tests pass.
- Focused regression run with Nous routes, force-stream configuration and Codex passthrough: 51 tests passed before the final two bridge tests were added.
- Full unit-suite attempt: 389 files passed, 32 files failed, 4 skipped; 4,119 tests passed, 51 failed, 27 skipped, 1 todo. Failures include existing translator normalization/security-source assertions and OAuth/mock transport issues; no clean baseline was run, so they are not claimed conclusively pre-existing. Full log: Hermes scratch `mlai-unit-suite.log`.
- Parent verification: dedicated upstream key saved via provider API, exact connection read back as active. Rendered provider page and Add-key form inspected; all three model IDs visible.
- Live `/v1/models` plus JSON/SSE requests on `/v1/chat/completions`, `/v1/messages`, `/v1/responses` passed against dev server and again against standalone production build. All six inference cases returned expected real model text and protocol-specific terminal events.
- Additional live checks passed: pixis and pixis-sol replies, system/multi-turn context preservation, 400 rejection of unsupported inputs on all three routes, 401 rejection of invalid local router key.
- `NEXT_DIST_DIR=.next-mlai-verify npm run build` passed including standalone asset copy; standalone runtime independently exercised on loopback port 20128.
- No commit/push. Protected dirty Kiro files were not edited.

One initial RED run used DefaultExecutor before the transport mock was corrected and sent a dummy unit-test key upstream, receiving 401. No real key was used and no agent job was launched. All subsequent provider tests mock proxyAwareFetch.
