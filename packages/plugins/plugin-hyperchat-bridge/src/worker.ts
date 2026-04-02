import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const PLUGIN_NAME = "hyperchat-bridge";
const DEFAULT_URL = "http://localhost:9098";

interface HyperChatToolDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description?: string; required?: boolean }>;
}

interface HyperChatToolsResponse {
  [service: string]: HyperChatToolDef[];
}

interface ExecuteResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Convert HyperChat tool parameter schema to JSON Schema for Paperclip.
 */
function toJsonSchema(
  params: Record<string, { type: string; description?: string; required?: boolean }>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, def] of Object.entries(params)) {
    properties[key] = {
      type: def.type ?? "string",
      ...(def.description ? { description: def.description } : {}),
    };
    if (def.required) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

const plugin = definePlugin({
  async setup(ctx) {
    const config = await ctx.config.get();
    const baseUrl = (config?.hyperchatUrl as string) ?? DEFAULT_URL;
    const enabledServices = (config?.enabledServices as string[]) ?? [];

    ctx.logger.info(`${PLUGIN_NAME}: connecting to HyperChat at ${baseUrl}`);

    // Discover available tools from HyperChat
    let toolsMap: HyperChatToolsResponse;
    try {
      const resp = await ctx.http.fetch(`${baseUrl}/api/tools`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      toolsMap = (await resp.json()) as HyperChatToolsResponse;
    } catch (err) {
      ctx.logger.error(
        `${PLUGIN_NAME}: failed to fetch HyperChat tools: ${err}`,
      );
      return;
    }

    // Register each service's tools with Paperclip
    let registeredCount = 0;
    for (const [service, tools] of Object.entries(toolsMap)) {
      // Filter by enabled services if configured
      if (enabledServices.length > 0 && !enabledServices.includes(service)) {
        continue;
      }

      for (const tool of tools) {
        const toolName = `hc_${service}_${tool.name}`;
        const displayName = `[HC] ${service}/${tool.name}`;

        ctx.tools.register(
          toolName,
          {
            displayName,
            description: `HyperChat ${service}: ${tool.description}`,
            parametersSchema: toJsonSchema(tool.parameters ?? {}),
          },
          async (params) => {
            try {
              const execResp = await ctx.http.fetch(
                `${baseUrl}/api/execute`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    service,
                    tool: tool.name,
                    params: params ?? {},
                  }),
                },
              );

              if (!execResp.ok) {
                return { error: `HyperChat returned HTTP ${execResp.status}` };
              }

              const result = (await execResp.json()) as ExecuteResponse;
              if (!result.success) {
                return { error: result.error ?? "Unknown HyperChat error" };
              }

              return {
                content: JSON.stringify(result.result, null, 2),
                data: result.result,
              };
            } catch (err) {
              return { error: `HyperChat call failed: ${err}` };
            }
          },
        );
        registeredCount++;
      }
    }

    ctx.logger.info(
      `${PLUGIN_NAME}: registered ${registeredCount} tools from ${Object.keys(toolsMap).length} services`,
    );
  },

  async onHealth() {
    // Verify HyperChat is reachable
    try {
      const resp = await globalThis.fetch(`${DEFAULT_URL}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        return { status: "ok", message: "HyperChat connected" };
      }
      return { status: "degraded", message: `HyperChat HTTP ${resp.status}` };
    } catch {
      return { status: "error", message: "HyperChat unreachable" };
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
