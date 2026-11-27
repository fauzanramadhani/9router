# ML AI Code native provider

Provider ID: `mlai-code`; public model: **`mlai/main`**.

ML AI Code supports only native OAuth device login. Add a connection on the provider dashboard and complete the official sign-in link. API-key connections are not accepted for creation, validation, diagnosis or inference. Removed cloud-agent model IDs are rejected rather than redirected to native inference.

The native executor obtains a connection-scoped run grant through the official laptop lifecycle and forwards the complete OpenAI request to the allowlisted native model gateway. System/history, tool declarations, tool results, full schemas, stream options and upstream SSE are preserved. There is no cloud job polling, transcript serialization, emulated tool envelope, file transport or conversation lease.

See [native login, grant lifecycle and limits](mlai-native-router.md). These endpoints are based on the inspected official CLI contract, not a published API guarantee. `main` is a routing identity, not verified underlying model provenance or measured context capacity.

## Local verification

Focused Vitest tests mock the network and create a unique scratch DATA_DIR. They cover native login, grant isolation, status-confirmed bounded lifecycle after idle/expiry/restart, stable per-connection projects, encrypted resumable grants, serialized admission and ambiguous-dispatch protection, configured synthetic account rotation, fullbody/SSE forwarding and rejection of API keys and removed model IDs before dispatch. They do not establish live multi-account support or authorize any build/deployment, editor changes or real database changes.
