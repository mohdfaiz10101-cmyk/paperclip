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

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string | null };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model?: string;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta } = ctx;

  const baseUrl = asString(config.baseUrl, "http://localhost:4000");
  const model = asString(config.model, "cloud/glm-4-flash");
  const systemPrompt = asString(
    config.systemPrompt,
    `You are ${agent.name ?? "an AI assistant"} working for a Paperclip-managed company. Complete the assigned task thoroughly and concisely.`,
  );
  const promptTemplate = asString(
    config.promptTemplate,
    "{{context.wakeReason}}",
  );
  const temperature = asNumber(config.temperature, 0.7);
  const maxTokens = asNumber(config.maxTokens, 2048);
  const timeoutSec = asNumber(config.timeoutSec, 120);
  const apiKey = asString(config.apiKey, "");

  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    agent,
    runId,
    context,
  };
  const userMessage = renderTemplate(promptTemplate, templateData);

  if (onMeta) {
    await onMeta({
      adapterType: "glm_http",
      command: `LiteLLM: ${baseUrl}/v1/chat/completions`,
      commandArgs: [model],
      context,
      prompt: userMessage,
    } satisfies AdapterInvocationMeta);
  }

  await onLog("stdout", `[glm-http] Model: ${model}, Base: ${baseUrl}\n`);
  await onLog("stdout", `[glm-http] Sending request...\n`);

  const startTime = Date.now();

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey) {
    headers["authorization"] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LiteLLM request failed: HTTP ${res.status} ${body}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    const content = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage;

    await onLog("stdout", `[glm-http] Completed in ${elapsedSec}s`);
    if (usage) {
      await onLog("stdout", ` (${usage.prompt_tokens}+${usage.completion_tokens}=${usage.total_tokens} tokens)`);
    }
    await onLog("stdout", `\n`);
    if (content) {
      await onLog("stdout", `[glm-http] Response:\n${content}\n`);
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
          }
        : undefined,
      provider: "litellm",
      biller: model,
      model: data.model ?? model,
      billingType: "api",
      costUsd: 0,
      summary: content,
      resultJson: data as unknown as Record<string, unknown>,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isTimeout = errorMessage.includes("abort");
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    await onLog("stderr", `[glm-http] Error after ${elapsedSec}s: ${errorMessage}\n`);

    return {
      exitCode: 1,
      signal: null,
      timedOut: isTimeout,
      errorMessage,
      errorCode: isTimeout ? "timeout" : "glm_http_error",
      provider: "litellm",
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}
