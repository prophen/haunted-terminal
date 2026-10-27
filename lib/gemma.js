// Gemma access, mirrored from Talk to the Book (lib/gemma.ts, proven live).
// Default here is cloud, because the hosted demo cannot reach a local Ollama.
// Set GEMMA_MODE=local to run against Ollama instead.

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const LOCAL_MODEL = process.env.GEMMA_LOCAL_MODEL ?? "gemma4:12b-it-qat";
const CLOUD_MODEL = process.env.GEMMA_CLOUD_MODEL ?? "gemma-4-26b-a4b-it";
// Overridable so a local mock can stand in for AI Studio when testing.
const CLOUD_BASE = process.env.GOOGLE_AI_STUDIO_BASE_URL ?? "https://generativelanguage.googleapis.com";

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

// Ways to switch thinking off, tried in order. Gemma 4 only takes
// thinkingLevel ("minimal" is off) and thinks only when asked, so the
// fallback sends no thinking config at all. thinkingBudget, the Gemini 2.5
// knob, is left out: with it Gemma 4 streamed nothing for two minutes.
const THINKING_OFF = [{ thinkingLevel: "minimal" }, null];

/** POST to AI Studio with thinking off, stepping down THINKING_OFF while the API rejects the setting. */
async function cloudRequest(method, system, user, extraConfig = {}) {
  const apiKey = process.env.GOOGLE_AI_STUDIO_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_AI_STUDIO_KEY.");
  const query = method === "streamGenerateContent" ? "?alt=sse" : "";
  for (let i = 0; ; i++) {
    const thinkingConfig = THINKING_OFF[i];
    const res = await fetch(`${CLOUD_BASE}/v1beta/models/${CLOUD_MODEL}:${method}${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.7,
          // No token cap: a fixed budget gets eaten by thinking, turning a
          // slow reply into an empty one. The passage trim bounds the output.
          ...extraConfig,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) return res;
    const detail = (await res.text()).slice(0, 300);
    // Step down on a rejected thinking setting, and on a 500: AI Studio
    // has answered an unsupported setting with a bare "Internal error".
    if (thinkingConfig && (res.status >= 500 || /thinking/i.test(detail))) {
      console.warn(`AI Studio ${res.status} with ${JSON.stringify(thinkingConfig)}, trying the next thinking setting`);
      continue;
    }
    throw new Error(`AI Studio ${res.status}: ${detail.slice(0, 200)}`);
  }
}

const replyText = (data) =>
  (data?.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");

async function tryCloud(system, user) {
  const res = await cloudRequest("generateContent", system, user, { responseMimeType: "application/json" });
  const text = replyText(await res.json());
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

/** Non-streaming cloud text call. Used as the fallback when the stream yields nothing. */
async function tryCloudText(system, user) {
  const res = await cloudRequest("generateContent", system, user);
  return replyText(await res.json());
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
 * Split a byte stream of server-sent events into the JSON payload of each
 * `data:` line. AI Studio separates events with CRLF ("\r\n\r\n"), so a
 * parser that only looks for "\n\n" never finds a boundary and sees the
 * whole reply at once when the stream closes. That was why the earlier
 * streaming attempt felt no faster than the non-streaming call.
 */
async function* sseData(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const payloads = function* (event) {
    for (const line of event.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload) yield payload;
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const event = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      yield* payloads(event);
    }
  }
  // The final event may arrive without a trailing blank line.
  buf += decoder.decode().replace(/\r\n?/g, "\n");
  if (buf.trim()) yield* payloads(buf);
}

/** Stream a local Ollama reply as text chunks (Ollama sends one JSON object per line). */
async function* streamLocal(system, user) {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LOCAL_MODEL,
      stream: true,
      think: false,
      options: { num_ctx: 8192, temperature: 0.7 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const textOf = (line) => {
    if (!line.trim()) return "";
    const data = JSON.parse(line);
    if (data.error) throw new Error(`Ollama: ${data.error}`);
    return data?.message?.content ?? "";
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const text = textOf(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
      if (text) yield text;
    }
  }
  const tail = textOf(buf);
  if (tail) yield tail;
}

/**
 * Stream Gemma's reply as text chunks, so the passage appears as it is
 * written instead of after one long wait. Cloud uses AI Studio's SSE
 * endpoint; local uses Ollama's streaming chat.
 */
export async function* gemmaStream(system, user) {
  const mode = (process.env.GEMMA_MODE ?? "cloud").toLowerCase();
  if (mode === "local") {
    yield* streamLocal(system, user);
    return;
  }
  const res = await cloudRequest("streamGenerateContent", system, user);

  // Track what the stream delivered, so an empty stream fails with a
  // diagnosis instead of a bare validation error downstream.
  let yielded = 0;
  let sawEvents = 0;
  let lastFinish = "";
  let blockReason = "";
  for await (const payload of sseData(res.body)) {
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      continue;
    }
    sawEvents += 1;
    if (data?.error) {
      const code = data.error.code ? `${data.error.code}: ` : "";
      throw new Error(`AI Studio ${code}${data.error.message ?? "stream error"}`);
    }
    const cand = data?.candidates?.[0];
    if (cand?.finishReason) lastFinish = cand.finishReason;
    if (data?.promptFeedback?.blockReason) blockReason = data.promptFeedback.blockReason;
    const text = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    if (text) {
      yielded += 1;
      yield text;
    }
  }

  if (yielded === 0) {
    // Nothing usable came through the stream. Try the non-streaming call
    // once: a passage that arrives whole beats no passage at all.
    const text = await tryCloudText(system, user).catch(() => "");
    if (text) {
      yield text;
      return;
    }
    throw new Error(
      `Gemma returned no text (events: ${sawEvents}, finish: ${lastFinish || "none"}, block: ${blockReason || "none"}).`
    );
  }
}
