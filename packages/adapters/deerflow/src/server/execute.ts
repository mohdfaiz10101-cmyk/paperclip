import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterInvocationMeta,
} from "@paperclipai/adapter-utils";

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

interface DeerFlowThread {
  thread_id: string;
  status?: string;
  created_at?: string;
}

interface DeerFlowRunResult {
  messages?: Array<{
    role: string;
    content: string;
    type?: string;
  }>;
  [key: string]: unknown;
}

async function createThread(gatewayUrl: string, metadata: Record<string, unknown>): Promise<DeerFlowThread> {
  const res = await fetch(`${gatewayUrl}/api/threads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metadata }),
  });
  if (!res.ok) {
    throw new Error(`DeerFlow create thread failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<DeerFlowThread>;
}

async function submitRunAndWait(
  gatewayUrl: string,
  threadId: string,
  input: { messages: Array<{ role: string; content: string }> },
  config: {
    assistantId: string;
    thinkingEnabled: boolean;
    subagentEnabled: boolean;
    planMode: boolean;
  },
  timeoutMs: number,
): Promise<DeerFlowRunResult> {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(`${gatewayUrl}/api/threads/${threadId}/runs/wait`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assistant_id: config.assistantId,
        input,
        config: {
          configurable: {
            thread_id: threadId,
          },
        },
        metadata: { source: "paperclip" },
        stream_mode: ["values"],
        context: {
          thinking_enabled: config.thinkingEnabled,
          is_plan_mode: config.planMode,
          subagent_enabled: config.subagentEnabled,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DeerFlow run failed: HTTP ${res.status} ${body}`);
    }

    return res.json() as Promise<DeerFlowRunResult>;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractSummary(result: DeerFlowRunResult): string {
  if (!result.messages || result.messages.length === 0) return "";
  const lastAssistant = [...result.messages]
    .reverse()
    .find((m) => m.role === "assistant" || m.type === "ai");
  return lastAssistant?.content ?? "";
}

function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const parts = path.split(".");
    let current: unknown = data;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return "";
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === "string" ? current : String(current ?? "");
  });
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta } = ctx;

  const gatewayUrl = asString(config.gatewayUrl, "http://localhost:8001");
  const assistantId = asString(config.assistantId, "lead_agent");
  const model = asString(config.model, "");
  const thinkingEnabled = asBoolean(config.thinkingEnabled, false);
  const subagentEnabled = asBoolean(config.subagentEnabled, false);
  const planMode = asBoolean(config.planMode, false);
  const timeoutSec = asNumber(config.timeoutSec, 300);
  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.name}}. Complete the following Paperclip task.",
  );

  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    agent,
    runId,
    context,
  };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);

  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const taskId =
    typeof context.taskId === "string" && context.taskId.trim().length > 0
      ? context.taskId.trim()
      : null;

  const taskContent = wakeReason ?? renderedPrompt;

  if (onMeta) {
    await onMeta({
      adapterType: "deerflow",
      command: `DeerFlow Gateway: ${gatewayUrl}`,
      commandArgs: [assistantId, model].filter(Boolean),
      context,
      prompt: taskContent,
    } satisfies AdapterInvocationMeta);
  }

  await onLog("stdout", `[deerflow] Connecting to ${gatewayUrl}\n`);
  await onLog("stdout", `[deerflow] Assistant: ${assistantId}, Model: ${model || "default"}\n`);

  const startTime = Date.now();

  try {
    // Reuse existing DeerFlow thread if available from session
    const existingThreadId =
      (runtime.sessionParams && typeof runtime.sessionParams.threadId === "string")
        ? runtime.sessionParams.threadId
        : null;

    let threadId: string;
    if (existingThreadId) {
      threadId = existingThreadId;
      await onLog("stdout", `[deerflow] Resuming thread: ${threadId}\n`);
    } else {
      const thread = await createThread(gatewayUrl, {
        paperclip_agent_id: agent.id,
        paperclip_run_id: runId,
        paperclip_task_id: taskId,
      });
      threadId = thread.thread_id;
      await onLog("stdout", `[deerflow] Created thread: ${threadId}\n`);
    }

    await onLog("stdout", `[deerflow] Submitting task...\n`);

    const result = await submitRunAndWait(
      gatewayUrl,
      threadId,
      {
        messages: [{ role: "user", content: taskContent }],
      },
      { assistantId, thinkingEnabled, subagentEnabled, planMode },
      timeoutSec * 1000,
    );

    const summary = extractSummary(result);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    await onLog("stdout", `[deerflow] Task completed in ${elapsedSec}s\n`);
    if (summary) {
      await onLog("stdout", `[deerflow] Result:\n${summary}\n`);
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: undefined,
      sessionId: threadId,
      sessionParams: {
        threadId,
        gatewayUrl,
        assistantId,
      },
      sessionDisplayId: threadId,
      provider: "deerflow",
      biller: model || "deerflow",
      model: model || "default",
      billingType: "api",
      costUsd: 0,
      resultJson: result as Record<string, unknown>,
      summary,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isTimeout = errorMessage.includes("abort");
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    await onLog("stderr", `[deerflow] Error after ${elapsedSec}s: ${errorMessage}\n`);

    return {
      exitCode: 1,
      signal: null,
      timedOut: isTimeout,
      errorMessage,
      errorCode: isTimeout ? "timeout" : "deerflow_error",
      provider: "deerflow",
      model: model || "default",
    };
  }
}
