// Gemma access, mirrored from Talk to the Book (lib/gemma.ts, proven live).
// Default here is cloud, because the hosted demo cannot reach a local Ollama.
// Set GEMMA_MODE=local to run against Ollama instead.

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const LOCAL_MODEL = process.env.GEMMA_LOCAL_MODEL ?? "gemma4:12b-it-qat";
const CLOUD_MODEL = process.env.GEMMA_CLOUD_MODEL ?? "gemma-4-26b-a4b-it";

async function tryLocal(system, user, think = false) {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LOCAL_MODEL,
      stream: false,
      format: "json",
      think,
      options: { num_ctx: 8192, num_predict: 1024, temperature: 0.7 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok && think !== undefined) {
    const detail = await res.clone().text().catch(() => "");
    if (/think/i.test(detail)) return tryLocal(system, user, undefined);
  }
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.message?.content;
  if (!text) throw new Error("Empty response from local Gemma.");
  return { text, source: "local", model: LOCAL_MODEL };
}

async function tryCloud(system, user, thinkingOff = true) {
  const apiKey = process.env.GOOGLE_AI_STUDIO_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_AI_STUDIO_KEY.");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CLOUD_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
          ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
      signal: AbortSignal.timeout(120_000),
    }
  );
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    if (thinkingOff && /thinking/i.test(detail)) return tryCloud(system, user, false);
    throw new Error(`AI Studio ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  if (!text) throw new Error("Empty response from cloud Gemma.");
  return { text, source: "cloud", model: CLOUD_MODEL };
}

/** Ask Gemma for a JSON answer. Cloud by default; local when asked or when no key exists. */
export async function gemmaJson(system, user) {
  const mode = (process.env.GEMMA_MODE ?? "cloud").toLowerCase();
  if (mode === "local") return tryLocal(system, user);
  if (mode === "cloud") return tryCloud(system, user);
  if (process.env.GOOGLE_AI_STUDIO_KEY) return tryCloud(system, user);
  return tryLocal(system, user);
}
