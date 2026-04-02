import type { AdapterEnvironmentTestContext, AdapterEnvironmentTestResult } from "@paperclipai/adapter-utils";
import { execSync } from "node:child_process";

function asString(val: unknown, fallback: string): string {
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : fallback;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentTestResult["checks"] = [];
  const remoteHost = asString(ctx.config.remoteHost, "");

  // Check aider binary
  try {
    const target = remoteHost
      ? `ssh -o ConnectTimeout=5 ${remoteHost} "which aider && aider --version" 2>&1`
      : "aider --version 2>&1";
    const version = execSync(target, { timeout: 15_000 }).toString().trim();
    checks.push({
      code: "aider_installed",
      level: "info",
      message: `Aider available: ${version.split("\n").pop()}`,
    });
  } catch {
    checks.push({
      code: "aider_missing",
      level: "error",
      message: remoteHost
        ? `Aider not found on remote host ${remoteHost}`
        : "Aider not installed locally",
      hint: "Install: pip install aider-chat",
    });
  }

  // Check model availability
  const model = asString(ctx.config.model, "glm-4.7");

  if (model.startsWith("ollama/")) {
    try {
      const ollamaHost = remoteHost || "localhost";
      const res = await fetch(`http://${ollamaHost}:11434/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        const modelName = model.replace("ollama/", "");
        const found = data.models?.some((m) => m.name.includes(modelName));
        checks.push({
          code: "ollama_model",
          level: found ? "info" : "warn",
          message: found
            ? `Ollama model ${modelName} available`
            : `Ollama model ${modelName} not pulled yet`,
          hint: found ? undefined : `Run: ollama pull ${modelName}`,
        });
      }
    } catch {
      checks.push({
        code: "ollama_unreachable",
        level: "warn",
        message: "Ollama not running",
        hint: "Start Ollama: ollama serve",
      });
    }
  } else if (model === "glm-4.7" || model.startsWith("glm")) {
    const glmKey = process.env.GLM_API_KEY ?? "";
    checks.push({
      code: "glm_api",
      level: glmKey ? "info" : "warn",
      message: glmKey ? "GLM API key configured" : "GLM API key not set (using hardcoded fallback)",
      hint: glmKey ? undefined : "Set GLM_API_KEY environment variable",
    });
  } else if (model.startsWith("deepseek")) {
    const dsKey = process.env.DEEPSEEK_API_KEY ?? "";
    checks.push({
      code: "deepseek_api",
      level: dsKey ? "info" : "error",
      message: dsKey ? "DeepSeek API key configured" : "DeepSeek API key not set",
      hint: dsKey ? undefined : "Get key at platform.deepseek.com and set DEEPSEEK_API_KEY",
    });
  }

  // Check remote connectivity
  if (remoteHost) {
    try {
      execSync(`ssh -o ConnectTimeout=5 -o BatchMode=yes ${remoteHost} "echo ok"`, {
        timeout: 10_000,
      });
      checks.push({
        code: "remote_reachable",
        level: "info",
        message: `Remote host ${remoteHost} reachable via SSH`,
      });
    } catch {
      checks.push({
        code: "remote_unreachable",
        level: "error",
        message: `Cannot reach remote host ${remoteHost}`,
        hint: "Check SSH connectivity and keys",
      });
    }
  }

  const hasError = checks.some((c) => c.level === "error");
  const hasWarn = checks.some((c) => c.level === "warn");

  return {
    adapterType: "aider_worker",
    status: hasError ? "fail" : hasWarn ? "warn" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}
