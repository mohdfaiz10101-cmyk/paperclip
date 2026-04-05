export const type = "aider_worker";
export const label = "Aider Worker (Multi-Model CLI)";

export const models = [
  { id: "glm-4.7", label: "GLM-4.7 (Coding Plan Free)" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3.2 Chat (Fast)" },
  { id: "deepseek/deepseek-reasoner", label: "DeepSeek V3.2 Reasoner (Thinking)" },
  { id: "ollama/deepseek-r1:7b", label: "DeepSeek R1 7B (Local Free)" },
  { id: "ollama/qwen3:8b", label: "Qwen3 8B (Local Free)" },
];

export const agentConfigurationDoc = `# aider_worker agent configuration

Adapter: aider_worker — Multi-model Aider CLI with 3-tier model architecture.

Core fields:
- model (string, required): Main model for planning. Options:
  - "glm-4.7" — GLM Coding Plan (free quota)
  - "deepseek/deepseek-chat" — DeepSeek V3.2 Chat (fast coding, $0.28/M)
  - "deepseek/deepseek-reasoner" — DeepSeek V3.2 Reasoner (thinking mode, bug analysis)
  - "ollama/deepseek-r1:7b" — Local 7B model (free)
  - "ollama/qwen3:8b" — Local Qwen3 (free)
- weakModel (string, optional): Cheap model for summaries/commits. Recommended: "cloud/glm-4-flash" (free)
- editorModel (string, optional): Model for code editing. Recommended: "deepseek/deepseek-chat"
- workDir (string, optional): Working directory for Aider (default: /tmp/aider-work)
- autoCommit (boolean, optional): Auto-commit changes (default: true)
- editFormat (string, optional): "whole" | "diff" | "udiff" (default: "whole")
- timeoutSec (number, optional): Timeout in seconds (default: 600)
- remoteHost (string, optional): SSH host for remote execution

3-tier model strategy (community best practice):
- model: Planning & understanding (main intelligence)
- weakModel: Summaries, commit messages (cost saving, ~40-60% cheaper)
- editorModel: Code editing (precision)

Notes:
- Aider auto-commits each AI edit to git
- GLM model routes through LiteLLM proxy
- DeepSeek reasoner uses thinking mode for complex analysis
- Local models require Ollama running
`;
