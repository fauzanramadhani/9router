# ML AI Code agent provider

Provider ID: `mlai-code`; model prefix alias: `mlai`.

Add **ML AI Code Agent** from the existing API-key provider screen using a `mlai_sk…` key. No cookies or OAuth are needed. New-key validation and saved-connection testing use a read-only authenticated `GET https://code.ml.ai/api/routines`; they do not start a job.

Models bundled from the upstream UI: `pixis-opus` (Opus 5.5R, default), `pixis` (Pixis), `pixis-sol` (GPT 6.1R Sol). All three returned real answers through the local 9router integration. Provider unit tests use mocked transport.

## Semantics and limits

This is an adapter to **undocumented internal agent APIs**, not a raw model inference API. A request starts a fresh remote job/workspace. The full text conversation is serialized as ordered JSON role/content entries in `task`. Job `completed` means workspace launch; the adapter then polls `/api/workspace` until `status.state` is `completed` and returns `status.result.submission`. It never returns the initial acknowledgement as the answer.

The existing OpenAI intermediary and client response conversions remain responsible for `/v1/chat/completions`, `/v1/messages`, and `/v1/responses`. The registry supplies models to the existing model catalogue. Raw-client preflight rejects unsupported data before intermediary translation can drop it.

- Text messages and **emulated client-side function tools**, not native inference function calling. OpenAI Chat function declarations, Responses function declarations/items, and Claude tool_use/tool_result history are normalized locally before shared repair/translation can invent missing results or rewrite IDs. Plain-text response formats are accepted.
- Tools are taught through a final system protocol contract in the serialized task. The upstream job still receives `tools: []`; the adapter never executes client tools or connects them to the upstream workspace. Clients execute returned calls and resend complete history with real results; each round starts a fresh isolated workspace.
- A tool-enabled final submission must be one strict JSON envelope with the exact fresh UUID nonce, `content` (text/null), and `tool_calls` (name plus JSON-object arguments). Exact declared-name allowlisting, none/auto/required/named choice, and disabled parallel calls are checked after parsing. No fuzzy names, loose JSON, missing nonce, copied old envelope, or tag parsing. Invalid/policy-violating submissions return sanitized 502 rather than actionable calls or a successful fabricated answer. No repair/retry agent job is launched.
- Call IDs and real text tool returns (including Claude error state) are preserved in the transcript. Orphan/duplicate/missing results and malformed history are rejected with 400; historical names need not remain in the current declarations. Images/audio/files, including nested tool results, hosted/freeform tools, legacy functions, strict schemas, structured response output, and multiple choices are unsupported (400).
- Tool parameter schemas are prompt guidance, **not JSON Schema enforcement**; only valid JSON-object arguments and protocol/policy constraints are enforced. Strict schemas are rejected. The client must validate arguments, authorize calls, and confirm destructive operations. A nonce is binding against accidental/replayed envelopes, not a security boundary against a model that sees the nonce or prompt injection. Never run untrusted tool calls automatically.
- Protocol compliance is model-dependent and this change has mocked unit evidence only; it is not a claim of live Copilot compatibility. Existing upstream agent behavior cannot be sandboxed by a prompt; no client tool implementation/credentials are provided upstream.
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
- Client-tool emulation focused run: 108 tests passed across 10 files (ML AI lifecycle/routes/plain-text regression/tools, parallel Responses tools, Claude response tools, stream IDs, custom Responses tools, non-stream Responses, terminal events). `tests/unit/mlai-code-tools.test.js` contains 31 cases. Transport mocked at `proxyAwareFetch`; no live tool execution, build, commit, push or deployment in this change.
- Observed RED evidence: initial supported-tool request returned 400 instead of 200; policy/parallel/history/SSE tests then exposed 10 failures; raw Claude/Responses history exposed 2 further failures; translator tests exposed lost parallel policy and flat named choice; Claude error-state test exposed dropped is_error. Each was followed by implementation and passing focused runs. The old blanket rejection fixture now specifically rejects strict function schemas.
- Tool responses emit OpenAI JSON `finish_reason: tool_calls` and buffered SSE with indexed calls, terminal finish reason, optional usage-only chunk for `stream_options.include_usage`, and `[DONE]`. Client response translators retain protocol-specific output/event conversion.
- Changed for tool emulation: `open-sse/services/mlaiCodeTools.js` (new), `open-sse/services/mlaiCode.js`, `open-sse/executors/mlai-code.js`, `open-sse/translator/index.js` (provider-scoped early lossless bridge), `tests/unit/mlai-code-tools.test.js` (new), `tests/unit/mlai-code.test.js`, this document. Parent-owned `tests/unit/mlai-code-copilot.test.js` unchanged.

Earlier text-only adapter verification (not evidence of live tool support):
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
