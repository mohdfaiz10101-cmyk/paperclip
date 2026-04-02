export const type = "aider_worker";
export const label = "Aider Worker (Multi-Model CLI)";

export const models = [
  { id: "glm-4.7", label: "GLM-4.7 (Coding Plan Free)" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3 ($0.28/M)" },
  { id: "ollama/deepseek-r1:7b", label: "DeepSeek R1 7B (Local Free)" },
  { id: "ollama/qwen3:8b", label: "Qwen3 8B (Local Free)" },
];

export const agentConfigurationDoc = `# aider_worker agent configuration

Adapter: aider_worker

Executes coding tasks via Aider CLI with multi-model support.

Core fields:
- model (string, required): Model to use. Options:
  - "glm-4.7" — GLM Coding Plan (free quota)
  - "deepseek/deepseek-chat" — DeepSeek V3 API ($0.28/M input)
  - "ollama/deepseek-r1:7b" — Local 7B model (free)
  - "ollama/qwen3:8b" — Local Qwen3 (free)
- workDir (string, optional): Working directory for Aider (default: /tmp/aider-work)
- autoCommit (boolean, optional): Auto-commit changes (default: true)
- editFormat (string, optional): "whole" | "diff" | "udiff" (default: "whole")
- timeoutSec (number, optional): Timeout in seconds (default: 600)
- remoteHost (string, optional): SSH host for remote execution (e.g. "nixos@minipc")

Notes:
- Aider auto-commits each AI edit to git
- GLM model uses Anthropic-compatible endpoint via Coding Plan
- Local models require Ollama running
- Remote execution via SSH for minipc/distributed workers
`;
