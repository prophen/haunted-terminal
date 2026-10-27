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

/** Non-streaming cloud text call: the Talk to the Book path, proven live. Used as the fallback when the stream yields nothing. */
async function tryCloudText(system, user, thinkingOff = true) {
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
          // No token cap: a fixed budget gets eaten by thinking (the model
          // thinks before it writes, and thinkingBudget 0 is not honored by
          // every Gemma), which turns a slow reply into an empty one. The
          // passage trim downstream bounds the output instead.
          ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
      signal: AbortSignal.timeout(120_000),
    }
  );
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    if (thinkingOff && /thinking/i.test(detail)) return tryCloudText(system, user, false);
    throw new Error(`AI Studio ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
}

/** Plain-text Gemma reply: local when asked, otherwise cloud. The Talk to the Book path: one call, whole reply, no streaming. */
export async function gemmaText(system, user) {
  const mode = (process.env.GEMMA_MODE ?? "cloud").toLowerCase();
  if (mode === "local") {
    const result = await tryLocal(system, user);
    return result.text;
  }
  return tryCloudText(system, user);
}

/**
 * Stream Gemma's reply as text chunks (cloud only; local mode yields one
 * chunk, the full reply). This is what makes the terminal feel alive: the
 * passage appears as it is written instead of after a 30 second wait.
 */
export async function* gemmaStream(system, user) {
  const mode = (process.env.GEMMA_MODE ?? "cloud").toLowerCase();
  if (mode === "local") {
    const result = await tryLocal(system, user);
    yield result.text;
    return;
  }
  const apiKey = process.env.GOOGLE_AI_STUDIO_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_AI_STUDIO_KEY.");

  const streamOnce = async (thinkingOff) =>
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CLOUD_MODEL}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.7,
            // No token cap, for the same reason as the fallback: a fixed
            // budget gets eaten by thinking, turning a slow reply into an
            // empty one. The passage trim downstream bounds the output.
            ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
        signal: AbortSignal.timeout(120_000),
      }
    );

  let res = await streamOnce(true);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    if (/thinking/i.test(detail)) {
      res = await streamOnce(false);
      if (!res.ok) throw new Error(`AI Studio ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } else {
      throw new Error(`AI Studio ${res.status}: ${detail.slice(0, 200)}`);
    }
  }

  // Track what the stream actually delivered, so an empty stream fails
  // with a diagnosis instead of a bare validation error downstream.
  let yielded = 0;
  let sawEvents = 0;
  let lastFinish = "";
  let blockReason = "";
  let streamError = null;
  const textsFromEvent = function* (event) {
    for (const line of event.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let data;
      try {
        data = JSON.parse(payload);
      } catch {
        continue; // Partial JSON mid-stream; the next chunk completes it.
      }
      sawEvents += 1;
      if (data?.error) {
        const code = data.error.code ? `${data.error.code}: ` : "";
        throw new Error(`AI Studio ${code}${data.error.message ?? "stream error"}`);
      }
      const cand = data?.candidates?.[0];
      if (cand?.finishReason) lastFinish = cand.finishReason;
      if (data?.promptFeedback?.blockReason) blockReason = data.promptFeedback.blockReason;
      const parts = cand?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");
      if (text) {
        yielded += 1;
        yield text;
      }
    }
  };

  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        yield* textsFromEvent(event);
      }
    }
    // Flush the tail: the final event may arrive without a trailing blank
    // line, and dropping it can lose the whole reply on a short stream.
    if (buf.trim()) yield* textsFromEvent(buf);
  } catch (e) {
    streamError = e;
  }

  if (yielded === 0) {
    // The stream delivered nothing usable. Fall back to the proven
    // non-streaming call instead of failing the turn: a passage that
    // arrives whole beats no passage at all.
    try {
      const text = await tryCloudText(system, user);
      if (text) {
        yield text;
        return;
      }
    } catch {
      // Fall through to the diagnostic error below.
    }
    if (streamError) throw streamError;
    throw new Error(
      `Gemma returned no text (events: ${sawEvents}, finish: ${lastFinish || "none"}, block: ${blockReason || "none"}).`
    );
  }
  if (streamError) throw streamError;
}
