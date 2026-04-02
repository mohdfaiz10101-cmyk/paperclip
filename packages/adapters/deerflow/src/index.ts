export const type = "deerflow";
export const label = "DeerFlow (Gateway API)";

export const models = [
  { id: "qwen3-8b", label: "Qwen3 8B (Local Ollama)" },
  { id: "deepseek-r1-14b", label: "DeepSeek R1 14B (Local Ollama)" },
  { id: "glm-4-flash", label: "GLM-4 Flash (Cloud Free)" },
];

export const agentConfigurationDoc = `# deerflow agent configuration

Adapter: deerflow

Core fields:
- gatewayUrl (string, required): DeerFlow gateway API URL, e.g. "http://localhost:8001"
- assistantId (string, optional): DeerFlow assistant/agent name, defaults to "lead_agent"
- model (string, optional): Model name to use in DeerFlow (must match DeerFlow config.yaml models)
- thinkingEnabled (boolean, optional): Enable thinking/reasoning mode
- subagentEnabled (boolean, optional): Enable DeerFlow sub-agents
- promptTemplate (string, optional): Prompt template for the task
- timeoutSec (number, optional): Request timeout in seconds (default: 300)
- streamMode (string, optional): "values" or "updates" (default: "values")

Notes:
- DeerFlow manages its own sandbox, MCP tools, and memory
- Tasks are submitted via the Gateway API /api/threads/{threadId}/runs/wait endpoint
- Each Paperclip run creates a new DeerFlow thread for isolation
- The adapter preserves DeerFlow thread IDs in session params for multi-turn conversations
`;
