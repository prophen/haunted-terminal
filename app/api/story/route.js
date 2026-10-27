import { gemmaStream } from "@/lib/gemma";

// Streaming format, not JSON: JSON cannot be shown progressively, and the
// whole point of the terminal is watching the ghost write. The route
// validates the marker shape before the client ever sees choices.
const SYSTEM = `You are Marlowe, a ghost who lives inside an old terminal.
A living reader has opened a seance with you. You tell a spooky story in
second person, one passage at a time, and the reader chooses what happens next.

Rules:
- Spooky, never gory. No graphic violence, no real-world tragedy, no jump
  scares described in graphic detail. Eerie and playful, PG.
- Each passage is 80 to 130 words, present tense, second person.
- Never use em dashes. Use commas, periods, or colons instead.
- Never break character. You are Marlowe, not an AI assistant.
- Never claim anything in the story is real. It is fiction.
- Write the passage first, then a line containing exactly ===CHOICES===,
  then exactly 3 short choices, one per line. No markdown, no numbering,
  no extra text after the choices.`;

const MARKER = "===CHOICES===";

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

  const user = `${storySoFar}\n\nContinue the story: write the next passage, then ${MARKER}, then exactly 3 choices, one per line.`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        let full = "";
        for await (const chunk of gemmaStream(SYSTEM, user)) {
          full += chunk;
          send({ chunk });
        }
        const at = full.indexOf(MARKER);
        if (at === -1) throw new Error("Gemma did not include the choices marker.");
        const passage = full.slice(0, at).trim();
        const choices = full
          .slice(at + MARKER.length)
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s.replace(/^\d+[\.\)]\s*/, "").replace(/^[-*]\s*/, "").trim())
          .filter(Boolean);
        if (passage.length < 20 || passage.length > 2000) throw new Error("Passage failed validation.");
        if (choices.length !== 3) throw new Error("Choices failed validation.");
        send({ done: true, passage, choices });
      } catch (e) {
        send({ error: e instanceof Error ? e.message.slice(0, 300) : "Story stream failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
