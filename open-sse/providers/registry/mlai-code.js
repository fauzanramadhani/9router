export default {
  id: "mlai-code",
  alias: "mlai",
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],
  authHint: "Sign in with native device OAuth. Only mlai/main is supported; API keys and cloud-agent models are not supported.",
  display: {
    name: "ML AI Code", icon: "code", color: "#6366F1", textIcon: "ML", website: "https://code.ml.ai",
  },
  transport: { baseUrl: "https://code.ml.ai/api/model/v1", format: "openai" },
  models: [{ id: "main", name: "ML AI native gateway (device login)" }],
};
