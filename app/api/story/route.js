import { gemmaJson } from "@/lib/gemma";

const SYSTEM = `You are Marlowe, a ghost who lives inside an old terminal.
A living reader has opened a seance with you. You tell a spooky story in
second person, one passage at a time, and the reader chooses what happens next.

Rules:
- Spooky, never gory. No graphic violence, no real-world tragedy, no jump
  scares described in graphic detail. Eerie and playful, PG.
- Each passage is 100 to 180 words, present tense, second person.
- Never use em dashes. Use commas, periods, or colons instead.
- Never break character. You are Marlowe, not an AI assistant.
- Never claim anything in the story is real. It is fiction.
- End every turn with exactly 3 short choices for the reader.
- Respond with JSON only, no markdown, exactly these keys:
  { "passage": "the next passage of the story", "choices": ["choice one", "choice two", "choice three"] }`;

function validate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
  const { passage, choices } = raw;
  if (typeof passage !== "string" || passage.trim().length < 20 || passage.length > 2000) {
    throw new Error("bad passage");
  }
  if (!Array.isArray(choices) || choices.length !== 3 || choices.some((c) => typeof c !== "string" || !c.trim())) {
    throw new Error("bad choices");
  }
  return { passage: passage.trim(), choices: choices.map((c) => c.trim()) };
}

function tolerantParse(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST(req) {
  let history;
  try {
    const body = await req.json();
    history = Array.isArray(body.history) ? body.history : [];
  } catch {
    return Response.json({ error: "Send { history: [{ role, text }] }." }, { status: 400 });
  }

  const storySoFar =
    history.length === 0
      ? "The reader has just opened the terminal. Begin a new spooky story."
      : history.map((h) => `${h.role === "reader" ? "Reader chose" : "Marlowe told"}: ${h.text}`).join("\n");

  const user = `${storySoFar}\n\nContinue the story with the next passage and exactly 3 choices.`;

  let result;
  let parsed = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const prompt =
      attempt === 0
        ? user
        : `${user}\n\nYour previous reply could not be parsed. Reply with the JSON object only: no prose, no markdown.`;
    try {
      result = await gemmaJson(SYSTEM, prompt);
    } catch (e) {
      return Response.json(
        {
          error: "Gemma is unreachable. For cloud mode, set GOOGLE_AI_STUDIO_KEY in .env.local. For local mode, set GEMMA_MODE=local and run Ollama.",
          detail: e instanceof Error ? e.message.slice(0, 300) : String(e),
        },
        { status: 502 }
      );
    }
    try {
      parsed = validate(tolerantParse(result.text));
    } catch (e) {
      console.error(`Gemma story reply failed validation (attempt ${attempt + 1}):`, e.message);
    }
  }

  if (!parsed || !result) {
    return Response.json({ error: "Gemma's reply was not a valid story passage, even after a retry." }, { status: 502 });
  }
  return Response.json({ ...parsed, gemmaSource: result.source, gemmaModel: result.model });
}
