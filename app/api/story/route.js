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
- Every response MUST end with a line containing exactly ===CHOICES===
  (no spaces inside the marker, alone on its line), then exactly 3 short
  choices, one per line. No markdown, no numbering, no extra text after
  the choices. The marker and the 3 choices are required, not optional.`;

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
        // Tolerant parse: accept marker spacing/casing variants, and never
        // fail the whole turn over missing choices. A passage with fallback
        // choices beats a demo fallback every time.
        const FALLBACK_CHOICES = ["Ask who it is", "Try to log out", "Type HELLO"];
        const markerMatch = full.match(/===+\s*CHOICES\s*===+/i);
        let passage = full.trim();
        let choices = [];
        if (markerMatch) {
          passage = full.slice(0, markerMatch.index).trim();
          choices = full
            .slice(markerMatch.index + markerMatch[0].length)
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => s.replace(/^\d+[\.\)]\s*/, "").replace(/^[-*]\s*/, "").trim())
            .filter(Boolean)
            .slice(0, 3);
        }
        if (passage.length < 20 || passage.length > 2000) throw new Error("Passage failed validation.");
        if (choices.length < 3) choices = [...choices, ...FALLBACK_CHOICES].slice(0, 3);
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
