import { z } from "zod";

/**
 * GLM HTTP Adapter Configuration Schema
 *
 * Validates agent configuration for the glm_http adapter type.
 * Provides runtime type safety and clear validation errors.
 */

export const GLMHttpConfigSchema = z.object({
  // LiteLLM proxy configuration
  baseUrl: z.string().url().optional().describe("LiteLLM proxy URL"),

  // Model selection
  model: z.enum([
    "cloud/glm-4-flash",
    "cloud/glm-4-plus",
    "cloud/glm-5.1",
    "cloud/glm-4-long",
  ]).optional().describe("GLM model ID"),

  // Prompting
  systemPrompt: z.string().optional().describe("System prompt prepended to requests"),
  promptTemplate: z.string().optional().describe("User message template with {{variables}}"),

  // Sampling parameters
  temperature: z.number().min(0).max(2).optional().describe("Sampling temperature (0-2)"),
  maxTokens: z.number().int().positive().optional().describe("Maximum response tokens"),
  doSample: z.union([z.boolean(), z.enum(["true", "false"])]).optional().describe("Enable sampling"),

  // HTTP configuration
  timeoutSec: z.number().int().positive().max(600).optional().describe("Request timeout in seconds"),
  apiKey: z.string().optional().describe("LiteLLM API key (Bearer token)"),

  // Web search features
  enableWebSearch: z.boolean().optional().describe("Enable GLM native web search"),
  webSearch: z.union([z.boolean(), z.enum(["true", "false"])]).optional().describe("Legacy web search flag"),
  webSearchEngine: z.string().optional().describe("Search engine type (e.g., search_pro)"),
}).strict(); // Reject unknown fields

export type GLMHttpConfig = z.infer<typeof GLMHttpConfigSchema>;

/**
 * Validate and parse GLM HTTP config with helpful error messages
 */
export function validateGLMHttpConfig(config: unknown): GLMHttpConfig {
  try {
    return GLMHttpConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map(issue =>
        `  - ${issue.path.join(".")}: ${issue.message}`
      ).join("\n");
      throw new Error(`Invalid glm_http configuration:\n${details}`);
    }
    throw error;
  }
}
