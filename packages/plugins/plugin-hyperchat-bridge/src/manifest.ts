import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const PLUGIN_ID = "paperclip.hyperchat-bridge";
const PLUGIN_VERSION = "0.1.0";

/**
 * HyperChat MCP Bridge — exposes HyperChat's 8 MCP services
 * (wechat, document, system, file, app, email, browser, crm)
 * as Paperclip agent tools.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "HyperChat MCP Bridge",
  description:
    "Bridges HyperChat MCP tools (WeChat, CRM, Document, Email, Browser, etc.) into Paperclip agent workflows.",
  author: "Charlie",
  categories: ["connector"],
  capabilities: [
    "agent.tools.register",
    "http.outbound",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      hyperchatUrl: {
        type: "string",
        description: "HyperChat API base URL",
        default: "http://localhost:9098",
      },
      enabledServices: {
        type: "array",
        items: { type: "string" },
        description: "Which MCP services to expose (empty = all)",
        default: [],
      },
    },
  },
};

export default manifest;
