import type { AdapterEnvironmentTestContext, AdapterEnvironmentTestResult } from "@paperclipai/adapter-utils";

function asString(val: unknown, fallback: string): string {
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : fallback;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentTestResult["checks"] = [];
  const gatewayUrl = asString(ctx.config.gatewayUrl, "http://localhost:8001");

  try {
    const res = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      checks.push({
        code: "gateway_reachable",
        level: "info",
        message: `DeerFlow gateway reachable at ${gatewayUrl}`,
      });
    } else {
      checks.push({
        code: "gateway_unhealthy",
        level: "error",
        message: `DeerFlow gateway returned HTTP ${res.status}`,
        hint: "Check if DeerFlow Docker containers are running: docker compose -p deer-flow ps",
      });
    }
  } catch (err) {
    checks.push({
      code: "gateway_unreachable",
      level: "error",
      message: `Cannot reach DeerFlow gateway at ${gatewayUrl}`,
      detail: err instanceof Error ? err.message : String(err),
      hint: "Start DeerFlow: cd /mnt/ai/ai-cluster/deerflow && docker compose -p deer-flow -f docker/docker-compose.yaml up -d",
    });
  }

  try {
    const modelsRes = await fetch(`${gatewayUrl}/api/models`, { signal: AbortSignal.timeout(10_000) });
    if (modelsRes.ok) {
      const data = (await modelsRes.json()) as { models?: unknown[] };
      const count = data.models?.length ?? 0;
      checks.push({
        code: "models_available",
        level: count > 0 ? "info" : "warn",
        message: `${count} model(s) configured in DeerFlow`,
        hint: count === 0 ? "Add models to DeerFlow config.yaml" : undefined,
      });
    }
  } catch {
    // Non-critical, gateway check already covers connectivity
  }

  const hasError = checks.some((c) => c.level === "error");
  const hasWarn = checks.some((c) => c.level === "warn");

  return {
    adapterType: "deerflow",
    status: hasError ? "fail" : hasWarn ? "warn" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}
