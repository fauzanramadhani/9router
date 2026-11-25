import { expect, it } from "vitest";
import { validateMlaiCodeRequest } from "../../open-sse/services/mlaiCode.js";

it("accepts explicit plain-text response format without treating it as structured output", () => {
  const messages = [{ role: "user", content: "Hello" }];
  expect(validateMlaiCodeRequest({ messages, response_format: { type: "text" } })).toBeNull();
  expect(validateMlaiCodeRequest({ messages, text: { format: { type: "text" } } })).toBeNull();
  expect(validateMlaiCodeRequest({ messages, response_format: { type: "json_schema" } })).toContain("unsupported");
});
