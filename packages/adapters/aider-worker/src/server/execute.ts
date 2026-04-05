import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterInvocationMeta,
} from "@paperclipai/adapter-utils";
import { spawn } from "node:child_process";

function asString(val: unknown, fallback: string): string {
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : fallback;
}

function asNumber(val: unknown, fallback: number): number {
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  if (typeof val === "string") {
    const n = Number(val);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function asBoolean(val: unknown, fallback: boolean): boolean {
  if (typeof val === "boolean") return val;
  if (val === "true") return true;
  if (val === "false") return false;
  return fallback;
}

interface AiderResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function buildAiderEnv(model: string): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };

  if (model === "glm-4.7" || model.startsWith("glm")) {
    // Route through LiteLLM proxy which handles JWT signing for Zhipu API
    env.OPENAI_API_BASE = "http://localhost:4000/v1";
    env.OPENAI_API_KEY = env.LITELLM_KEY ?? "sk-litellm-charlie-2026";
  } else if (model.startsWith("deepseek")) {
    env.OPENAI_API_BASE = "http://localhost:4000/v1";
    env.OPENAI_API_KEY = env.LITELLM_KEY ?? "sk-litellm-charlie-2026";
  }
  // ollama models use OLLAMA_API_BASE (default localhost:11434)

  return env;
}

function buildAiderArgs(
  model: string,
  task: string,
  opts: {
    autoCommit: boolean;
    editFormat: string;
    workDir: string;
    weakModel?: string;
    editorModel?: string;
  },
): string[] {
  const args: string[] = [
    "--yes",
    "--no-auto-lint",
    "--no-suggest-shell-commands",
  ];

  if (opts.autoCommit) {
    args.push("--auto-commits");
  } else {
    args.push("--no-auto-commits");
  }

  if (opts.editFormat) {
    args.push("--edit-format", opts.editFormat);
  }

  // Model selection — all models go through LiteLLM with openai/ prefix
  if (model === "glm-4.7" || model.startsWith("glm")) {
    args.push("--model", `openai/glm-code`);
  } else if (model.startsWith("deepseek")) {
    args.push("--model", `openai/${model}`);
  } else {
    args.push("--model", model);
  }

  // Weak model for summarization/commit messages (e.g. free glm-4-flash)
  const weakModel = opts.weakModel ?? "";
  if (weakModel) {
    if (weakModel.startsWith("glm") || weakModel.startsWith("cloud/")) {
      args.push("--weak-model", `openai/${weakModel.replace(/^cloud\//, "")}`);
    } else {
      args.push("--weak-model", weakModel);
    }
  }

  // Editor model for code editing operations
  const editorModel = opts.editorModel ?? "";
  if (editorModel) {
    if (editorModel.startsWith("deepseek")) {
      args.push("--editor-model", `openai/${editorModel}`);
    } else if (editorModel.startsWith("glm") || editorModel.startsWith("cloud/")) {
      args.push("--editor-model", `openai/${editorModel.replace(/^cloud\//, "")}`);
    } else {
      args.push("--editor-model", editorModel);
    }
  }

  args.push("--message", task);

  return args;
}

async function runAider(
  args: string[],
  env: Record<string, string>,
  workDir: string,
  timeoutMs: number,
  onLog: (stream: "stdout" | "stderr", data: string) => Promise<void>,
): Promise<AiderResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = spawn("aider", args, {
      cwd: workDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs) : null;

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      void onLog("stdout", text);
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      void onLog("stderr", text);
    });

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout,
        stderr: stderr + `\n${err.message}`,
        timedOut: false,
      });
    });
  });
}

async function runRemoteAider(
  remoteHost: string,
  model: string,
  task: string,
  timeoutMs: number,
  onLog: (stream: "stdout" | "stderr", data: string) => Promise<void>,
): Promise<AiderResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Use the paperclip-aider-worker script on remote host
    const modelKey = model.startsWith("ollama/") ? "local"
      : model.startsWith("deepseek") ? "deepseek"
      : "glm";

    const proc = spawn("ssh", [
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=no",
      remoteHost,
      `paperclip-aider-worker ${modelKey} '${task.replace(/'/g, "'\\''")}'`,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs) : null;

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      void onLog("stdout", text);
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      void onLog("stderr", text);
    });

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr, timedOut });
    });

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: stderr + `\n${err.message}`, timedOut: false });
    });
  });
}

function extractSummary(stdout: string): string {
  // Extract the last meaningful output section from Aider
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  // Return last 30 lines as summary
  return lines.slice(-30).join("\n");
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta } = ctx;

  const model = asString(config.model, "glm-4.7");
  const weakModel = asString(config.weakModel, "");
  const editorModel = asString(config.editorModel, "");
  const workDir = asString(config.workDir, "/tmp/aider-work");
  const autoCommit = asBoolean(config.autoCommit, true);
  const editFormat = asString(config.editFormat, "whole");
  const timeoutSec = asNumber(config.timeoutSec, 600);
  const remoteHost = asString(config.remoteHost, "");

  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;

  const taskContent = wakeReason ?? `Complete the following task for agent ${agent.name}: ${JSON.stringify(context)}`;

  if (onMeta) {
    await onMeta({
      adapterType: "aider_worker",
      command: remoteHost ? `ssh ${remoteHost} aider` : "aider",
      commandArgs: ["--model", model, "--message", taskContent.slice(0, 100)],
      context,
      prompt: taskContent,
    } satisfies AdapterInvocationMeta);
  }

  const isRemote = remoteHost.length > 0;
  const location = isRemote ? remoteHost : "local";

  await onLog("stdout", `[aider] Model: ${model} | Location: ${location}\n`);
  await onLog("stdout", `[aider] Task: ${taskContent.slice(0, 200)}...\n`);

  const startTime = Date.now();

  let result: AiderResult;

  if (isRemote) {
    await onLog("stdout", `[aider] Connecting to ${remoteHost}...\n`);
    result = await runRemoteAider(remoteHost, model, taskContent, timeoutSec * 1000, onLog);
  } else {
    // Ensure work directory exists
    const { mkdirSync } = await import("node:fs");
    mkdirSync(workDir, { recursive: true });

    const env = buildAiderEnv(model);
    const args = buildAiderArgs(model, taskContent, { autoCommit, editFormat, workDir, weakModel, editorModel });

    await onLog("stdout", `[aider] Working directory: ${workDir}\n`);
    result = await runAider(args, env, workDir, timeoutSec * 1000, onLog);
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = extractSummary(result.stdout);

  await onLog("stdout", `[aider] Completed in ${elapsedSec}s (exit: ${result.exitCode})\n`);

  // Estimate cost based on model
  let costUsd = 0;
  if (model.startsWith("deepseek")) {
    // Rough estimate: ~2000 tokens per task, DeepSeek $0.28/M input + $0.42/M output
    costUsd = 0.001;
  }

  const billingType = model.startsWith("ollama/") ? "fixed" as const
    : model === "glm-4.7" ? "subscription_included" as const
    : "api" as const;

  return {
    exitCode: result.exitCode,
    signal: null,
    timedOut: result.timedOut,
    usage: undefined,
    provider: "aider",
    biller: model,
    model,
    billingType,
    costUsd,
    summary,
    ...(result.exitCode !== 0 ? {
      errorMessage: result.stderr.slice(-500),
      errorCode: result.timedOut ? "timeout" : "aider_error",
    } : {}),
  };
}
