import { PROVIDERS } from "../config/providers.js";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../translator/schema/index.js";

// Run on the original request: intermediary translators may otherwise discard unsupported blocks.
export function validateMlaiCodeRequest(body) {
  const error = "ML AI Code: images, audio, files, tools and structured output are unsupported; send text-only messages";
  if (body.tools?.length || body.functions?.length || body.response_format || body.text?.format || body.audio ||
      body.attachments?.length || body.files?.length || body.images?.length ||
      body.modalities?.some(m => m !== OPENAI_BLOCK.TEXT) || (body.tool_choice && body.tool_choice !== "none") ||
      (body.function_call && body.function_call !== "none")) return error;
  const textBlocks = new Set([OPENAI_BLOCK.TEXT, RESPONSES_ITEM.INPUT_TEXT, RESPONSES_ITEM.OUTPUT_TEXT]);
  const validContent = content => typeof content === "string" || (Array.isArray(content) && content.every(p => p && textBlocks.has(p.type) && typeof p.text === "string"));
  const messages = body.messages || (Array.isArray(body.input) ? body.input : []);
  for (const message of messages) {
    if (typeof message === "string") continue;
    if (!message || message.role === ROLE.TOOL || message.role === ROLE.FUNCTION || message.tool_calls?.length || message.function_call || message.audio ||
        message.attachments?.length || (message.type && message.type !== RESPONSES_ITEM.MESSAGE) || !validContent(message.content)) return error;
  }
  if (body.system && !validContent(body.system)) return error;
  return null;
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
