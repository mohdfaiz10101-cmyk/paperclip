export const type = "glm_http";
export const label = "GLM via LiteLLM (HTTP)";

export const models = [
  { id: "cloud/glm-4-flash", label: "GLM-4 Flash (Free, Simple)" },
  { id: "cloud/glm-4-plus", label: "GLM-4 Plus (Standard)" },
  { id: "cloud/glm-5.1", label: "GLM-5.1 (Complex)" },
  { id: "cloud/glm-4-long", label: "GLM-4 Long (128K Context)" },
];

export const agentConfigurationDoc = `# glm_http agent configuration

Adapter: glm_http — GLM via LiteLLM with native Web Search support.

Core fields:
- baseUrl (string, optional): LiteLLM proxy URL. Default: "http://localhost:4000"
- model (string, optional): Model ID. Options:
  - "cloud/glm-4-flash" — Free, fast, for simple tasks (default)
  - "cloud/glm-4-plus" — Standard capability
  - "cloud/glm-5.1" — Strongest, for complex tasks
  - "cloud/glm-4-long" — 128K context for long documents
- systemPrompt (string, optional): System prompt prepended to every request
- promptTemplate (string, optional): Template for the user message. Supports {{context.wakeReason}}, {{agent.name}}
- temperature (number, optional): Sampling temperature 0-2. Default: 0.7
- maxTokens (number, optional): Max response tokens. Default: 2048
- timeoutSec (number, optional): Request timeout in seconds. Default: 120
- apiKey (string, optional): API key header for LiteLLM (if auth enabled)
- enableWebSearch (boolean, optional): Enable GLM native web search. Default: false
- webSearchEngine (string, optional): Search engine type. Default: "search_pro"

Notes:
- Uses OpenAI-compatible /v1/chat/completions endpoint via LiteLLM
- Web search uses GLM's native web_search tool (no external API needed)
- When web search is enabled, temperature is capped at 0.5 for better results
- Token usage is tracked for cost reporting
- Zero cost with GLM-4 Flash (free tier via ZhiPu)
`;
