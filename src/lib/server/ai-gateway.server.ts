import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable-ai-gateway",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}

export function getGatewayOrThrow() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI is not configured — missing LOVABLE_API_KEY.");
  return createLovableAiGatewayProvider(key);
}

export const COPILOT_MODEL = "google/gemini-3-flash-preview";
