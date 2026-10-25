/**
 * Minimal Gemini client for the local dev server (Node 20+, global fetch).
 * Uses the REST generateContent endpoint with JSON output that follows a schema.
 * The API key stays on this server and is sent only to Google, in a header.
 */

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

export interface GeminiRequest {
  system: string;
  user: string;
  /** OpenAPI-style schema for the JSON reply, e.g. { type: 'OBJECT', properties: {...}, required: [...] }. */
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 12000;

export async function generateJson(cfg: GeminiConfig, req: GeminiRequest): Promise<{ data: unknown; tokens: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: req.schema,
          maxOutputTokens: req.maxOutputTokens ?? 400,
          temperature: req.temperature ?? 0.8,
        },
      }),
    });
    if (!res.ok) {
      // Never echo the request (it contains the key header); the status and a short body are enough.
      const body = (await res.text()).slice(0, 300);
      throw new Error(`Gemini HTTP ${res.status}: ${body}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };
    const cand = json.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new Error(`Gemini returned no text (finishReason: ${cand?.finishReason ?? 'unknown'})`);
    const u = json.usageMetadata;
    const tokens = u ? `${u.promptTokenCount ?? '?'} in / ${u.candidatesTokenCount ?? '?'} out` : 'usage unknown';
    return { data: JSON.parse(text), tokens };
  } finally {
    clearTimeout(timer);
  }
}
