export default {
  id: "mlai-code",
  alias: "mlai",
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],
  authHint: "Sign in with native device OAuth. Custom model IDs are forwarded to the native upstream; acceptance does not verify a distinct backend. API keys are not supported.",
  display: {
    name: "ML AI Code", icon: "code", color: "#6366F1", textIcon: "ML", website: "https://code.ml.ai",
  },
  transport: { baseUrl: "https://code.ml.ai/api/model/v1", format: "openai" },
  models: [
    { id: "main", name: "ML AI native gateway (default route)" },
    { id: "mlai-code", name: "ML AI Code (upstream catalogue ID)" },
  ],
};
