import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";

function asString(val: unknown, fallback: string): string {
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : fallback;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentTestResult["checks"] = [];
  const baseUrl = asString(ctx.config.baseUrl, "http://localhost:4000");
  const model = asString(ctx.config.model, "cloud/glm-4-flash");

  // Check LiteLLM health
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      checks.push({
        code: "litellm_reachable",
        level: "info",
        message: `LiteLLM proxy reachable at ${baseUrl}`,
      });
    } else {
      checks.push({
        code: "litellm_unhealthy",
        level: "error",
        message: `LiteLLM proxy returned HTTP ${res.status}`,
        hint: "Check if LiteLLM is running: docker ps | grep litellm",
      });
    }
  } catch (err) {
    checks.push({
      code: "litellm_unreachable",
      level: "error",
      message: `Cannot reach LiteLLM at ${baseUrl}`,
      detail: err instanceof Error ? err.message : String(err),
      hint: "Start LiteLLM: cd /mnt/ai/ai-cluster/spectrai && docker compose up -d litellm",
    });
  }

  // Check model availability
  try {
    const modelsRes = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(10_000) });
    if (modelsRes.ok) {
      const data = (await modelsRes.json()) as { data?: Array<{ id: string }> };
      const modelIds = data.data?.map((m) => m.id) ?? [];
      const found = modelIds.includes(model);
      checks.push({
        code: "model_available",
        level: found ? "info" : "warn",
        message: found
          ? `Model "${model}" is available (${modelIds.length} total models)`
          : `Model "${model}" not found in ${modelIds.length} available models`,
        hint: found ? undefined : `Available: ${modelIds.join(", ")}`,
      });
    }
  } catch {
    // Non-critical, LiteLLM check already covers connectivity
  }

  const hasError = checks.some((c) => c.level === "error");
  const hasWarn = checks.some((c) => c.level === "warn");

  return {
    adapterType: "glm_http",
    status: hasError ? "fail" : hasWarn ? "warn" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}
