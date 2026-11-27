# ML AI native device integration in 9router

## Native OAuth only

On the ML AI Code provider page, **Native Device Login** opens the native device login dialog. Complete official browser sign-in using the link. API-key connections and the cloud-agent adapter have been removed. Native sign-in stores a separate `accessToken`, `expiresAt`, and `providerSpecificData.mlaiNative: true` on the selected provider connection. It never reads, resets, imports, or changes `~/.mlai`.

Use `mlai/main` for the native gateway. Removed catalogue names are rejected locally, not silently remapped to native. The native gateway uses `main`, as in the inspected official device recipe; accepting a model string is not evidence of a selectable backend.

## Inspected protocol (not a published API guarantee)

Source contract: distributed official `mlai-code@0.3.32` Windows CLI, function `YP` in `bin/mlai.exe`.

1. Bind an ephemeral HTTP listener to `127.0.0.1` and generate a random 32-byte PKCE verifier, SHA256/base64url challenge, and random 24-byte/base64url state.
2. Open `https://code.ml.ai/clients/auth` with `port`, `state`, `challenge`, `surface=laptop`, and `label`.
3. Accept only GET `/callback`, the exact loopback Host/port and exact constant-time state match. The code must be 50–3500 characters. Denial cancels. Callbacks cannot complete twice.
4. Server-side POST `https://code.ml.ai/api/clients` JSON `{action:"exchange",code,verifier}`. Validate `token` starts with `mlaid_`, future numeric millisecond `expires`, and `surface=laptop`. Neither verifier nor device token is returned to the dashboard.
5. Connection-scoped POST `/api/laptop` with `action:start`, `engineCaps:1`, project identity, and official laptop device headers obtains an expiring run grant. Only the exact gateway `https://code.ml.ai/api/model/v1` is trusted.
6. Forward the full OpenAI request to `/chat/completions` with the run grant. Native tools, tool history, full schemas, system/history, stream options and upstream SSE body are retained. No cloud transcript envelope, emulated tool protocol, context cap, or file transport is used.

### Remote-server sign-in (manual callback, like Codex)

1. Open **Native Device Login** in your authenticated HTTPS dashboard, then open the official sign-in link.
2. Complete sign-in. On a different computer from the router host, the redirected `http://127.0.0.1:PORT/callback?...` page may show `ERR_CONNECTION_REFUSED`: its loopback address refers to your browser's computer, not the server.
3. Copy the **complete address-bar URL** from that failed callback tab. Return to the still-open native login dialog, paste it into **Paste callback URL**, and select **Complete sign-in**. Do not paste only the code, reuse an earlier attempt, or share the URL: it contains a one-time secret.

Local automatic loopback callbacks still work; no tunnel is required for manual completion. Both paths use the same server-owned session, strict callback parser, and single-exchange guard. The pasted URL is parsed only, never fetched. Only the exact `http://127.0.0.1:<session-port>/callback` target and matching state are accepted; credentials, fragments, duplicate/unknown parameters, mixed code/error responses and malformed codes are rejected. Only a state-matched `error=access_denied` without any code cancels sign-in. The PKCE verifier never leaves the server, and the exchange endpoint is fixed.

The existing authenticated `/api/oauth/mlai-code/native` POST route accepts `{action:"callback",session,callbackUrl}` alongside start/status/cancel. Browser requests use same-origin JSON; cross-site/foreign-origin submissions are rejected. Do not weaken dashboard authentication or trust caller-supplied forwarding headers. Sanitized terminal status remains readable until session cleanup so polling cannot consume the result before manual completion sees it. Cancel/expiry wins before persistence begins; persistence is the commit point and cannot be cancelled mid-write. No callback codes, verifiers or device tokens are logged or returned in status.

Login sessions expire after three minutes; close/cancel cleans up their listener. In-memory route entries expire after four minutes and are swept on subsequent requests. Restarting the router loses pending login sessions; restart sign-in rather than reusing an old callback. This is a Node runtime feature, not an edge-worker login flow.

## Expiry, rotation and restrictions

Native grants are scoped to connection ID **and** SHA256 device credential fingerprint. Grants/project metadata are persisted under `DATA_DIR/mlai-native-sessions` using AES-256-GCM with a key derived from the existing private device credential and scope-bound authenticated data; plaintext tokens are never written or logged. Atomic writes request 0600 and directory 0700 (Windows inherits application-data ACLs). Stable project UUIDs derive from router-owned connection IDs, not client request fields. Credential rotation is a separate scope, not permission to evade restrictions. Concurrent lifecycle requests share one pending operation; an exclusive temporary file lock serializes independent instances and is released after the operation. Only locks whose owning PID is confirmed gone can be recovered automatically.

The permanent admission-marker fallback is removed. Successful grants survive restart and are checked read-only before reuse. An encrypted admission-pending state exists only while a start outcome is ambiguous (transport failure/crash or invalid grant); it prevents duplicate billing until an operator reconciles that genuinely unknown outcome. It is replaced by resumable state on success. Old in-memory-only grants cannot be reconstructed by deploying this source.

Device credentials have no demonstrated refresh-token endpoint. Expiry/revocation requires reconnecting native login. Authentication, billing, access and rate errors preserve HTTP status/Retry-After and never trigger renewal or replay. Restricted grants remain blocked in persisted state; do not rotate accounts/credentials to bypass restrictions.

The legacy text-only preflight and transcript normalizer are removed. Native requests bypass capability-based modality stripping, tool deduplication, automatic token-saving compression, and generic 401/403 refresh retries. Other wire formats use existing shared translators; their full fidelity and live client compatibility require separate runtime acceptance. Provider-level/custom prompt policies remain explicit user configuration.

Diagnosis on native connections checks credential shape/expiry **metadata only**, makes no network request and does not claim upstream acceptance. It never starts a billable run.

## Bounded automatic native lifecycle

The user authorizes automatic lifecycle. A read-only official status response was observed with exactly `runId,tokens,calls,running,budget,expires` (HTTP 200, running false, budget 40000000, tokens 881345, calls 62). This establishes an observed schema, not an account-wide quota contract or closure reason. The adapter conservatively requires numeric nonnegative values, matching run identity, no unknown/restriction fields, `running:false`, `budget>tokens`, and an unexpired device credential before one new start on the same stable project. A running unexpired grant is reused. Expired grants, restart and idle gaps of 60 seconds require status preflight. Non-2xx, malformed/unknown responses, exhausted allowance and running-but-expired grants fail closed without start. Laptop fetch plus full response body have a 60-second deadline and 64-KiB body bound.

Only an explicit structured `run_finished` in an HTTP 409 inference rejection permits one status-confirmed renewal and one exact full-body retry per execution. Generic 409 never qualifies. The exact message `This run has ended` remains a sanitized closure diagnostic but does not authorize replay. Successful JSON/SSE responses pass through untouched; later stream/body failures cannot trigger replay. No response is buffered for replay, no finish/keepalive is guessed, and tool rounds retain complete system/history/tools. Concurrent inference responses are not globally serialized; only lifecycle transitions are serialized. This is a connection-owned native inference lifecycle, not a claim of upstream conversation ownership or measured uninterrupted editor reliability.

Safe diagnostics read at most 8192 bytes within 1000 ms and expose fixed allowlisted messages/codes, never raw upstream text. HTTP status and Retry-After survive. The official CLI status request is POST `/api/laptop` with `Authorization: Bearer <run grant>` and JSON body exactly `{"action":"status"}`. Its `readOnly:true` is a wrapper option, not a JSON field; the device credential is used for start, not status. Live QA and deployment remain separate parent-owned gates.

## Verification and remaining gates

Focused tests mock `proxyAwareFetch` itself. Login tests make synthetic local loopback callbacks with a mocked official exchange and mocked connection persistence; they never open the official login page or use an existing account. Test configuration creates an isolated scratch DATA_DIR.

Remote callback changes passed 121 focused ML AI tests across 15 files, including synthetic loopback/manual login, rejection and concurrency tests. The modal test checks its source wiring, not rendered browser interaction. An isolated production webpack build also passed with a unique output directory and scratch DATA_DIR; build-time database initialization stayed in that scratch directory. No deployment, running-server change, real login, editor exercise or protected account database operation was performed. Historical live native verification is separate from this change. Reverse-proxy runtime origin behavior and actual browser/account acceptance remain parent-owned gates; two-real-account support and measured context capacity remain unverified.
