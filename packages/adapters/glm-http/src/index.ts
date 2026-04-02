export const type = "glm_http";
export const label = "GLM via LiteLLM (HTTP)";

export const models = [
  { id: "cloud/glm-4-flash", label: "GLM-4 Flash (Free)" },
  { id: "cloud/glm-4", label: "GLM-4 (Standard)" },
  { id: "cloud/glm-4-plus", label: "GLM-4 Plus (Premium)" },
];

export const agentConfigurationDoc = `# glm_http agent configuration

Adapter: glm_http — Lightweight LLM adapter via LiteLLM OpenAI-compatible API.

Core fields:
- baseUrl (string, optional): LiteLLM proxy URL. Default: "http://localhost:4000"
- model (string, optional): Model ID as registered in LiteLLM. Default: "cloud/glm-4-flash"
- systemPrompt (string, optional): System prompt prepended to every request
- promptTemplate (string, optional): Template for the user message. Supports {{context.wakeReason}}, {{agent.name}}
- temperature (number, optional): Sampling temperature 0-2. Default: 0.7
- maxTokens (number, optional): Max response tokens. Default: 2048
- timeoutSec (number, optional): Request timeout in seconds. Default: 120
- apiKey (string, optional): API key header for LiteLLM (if auth enabled)

Notes:
- Uses OpenAI-compatible /v1/chat/completions endpoint
- Token usage is tracked for cost reporting
- Ideal for lightweight tasks: docs, translation, formatting, data processing
- Zero cost with GLM-4 Flash (free tier via ZhiPu)
`;
