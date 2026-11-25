import { PROVIDERS } from "../config/providers.js";
import { normalizeMlaiCodeRequest } from "./mlaiCodeTools.js";

// Run on the original request: intermediary translators may otherwise discard unsupported blocks.
export function validateMlaiCodeRequest(body) {
  const error = "ML AI Code: unsupported input; use text and non-strict function tools only (no images, audio, files, structured output or multiple choices)";
  try {
    if (!body || body.functions?.length ||
        (body.response_format && body.response_format.type !== "text") ||
        (body.text?.format && body.text.format.type !== "text") || body.audio ||
        body.attachments?.length || body.files?.length || body.images?.length ||
        (body.modalities != null && (!Array.isArray(body.modalities) || body.modalities.some(m => m !== "text"))) ||
        (body.function_call && body.function_call !== "none") || (body.n != null && body.n !== 1)) return error;
    normalizeMlaiCodeRequest(body);
    return null;
  } catch { return error; }
}

// Read-only authentication check: never launch a billable agent for credential testing.
export async function probeMlaiCodeKey(apiKey, fetcher = fetch) {
  const config = PROVIDERS["mlai-code"];
  const response = await fetcher(config.validateUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(config.validationTimeoutMs),
  });
  const valid = response.ok;
  await response.body?.cancel();
  return { valid, error: valid ? null : `ML AI Code agent key verification failed (HTTP ${response.status}); use an mlai_sk key` };
}
