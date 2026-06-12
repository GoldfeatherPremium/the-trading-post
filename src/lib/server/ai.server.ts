/**
 * Lovable AI Gateway helper — minimal server-side wrapper around the
 * OpenAI-compatible chat completions endpoint. Used by Phase 3 features
 * (product generator, dispute assistant, fraud scorer).
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiCallOptions {
  messages: AiMessage[];
  model?: string;
  responseJson?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export class AiGatewayError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function callAi(opts: AiCallOptions): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new AiGatewayError("AI service not configured.", 500);

  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_MODEL,
    messages: opts.messages,
  };
  if (opts.responseJson) body.response_format = { type: "json_object" };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) throw new AiGatewayError("AI is busy — try again shortly.", 429);
  if (res.status === 402) throw new AiGatewayError("AI credits exhausted.", 402);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new AiGatewayError(`AI error: ${t.slice(0, 200) || res.statusText}`, res.status);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new AiGatewayError("Empty AI response.", 502);
  return content;
}

export async function callAiJson<T>(opts: Omit<AiCallOptions, "responseJson">): Promise<T> {
  const raw = await callAi({ ...opts, responseJson: true });
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Some models wrap JSON in ```json fences — strip and retry parse
    const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    return JSON.parse(stripped) as T;
  }
}
