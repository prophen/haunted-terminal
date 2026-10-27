import { gemmaText } from "@/lib/gemma";

// SSE envelope, one done event: the story arrives whole from the
// non-streaming call (the streaming endpoint proved unreliable: empty
// replies and multi-minute waits), and the route validates the marker
// shape before the client ever sees choices.
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
        // Non-streaming first: the proven Talk to the Book path. The passage
        // arrives whole after one call instead of word by word, and the
        // client already handles a done event with no prior chunks.
        const full = await gemmaText(SYSTEM, user);
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
        // Long passages happen when Gemma ignores the word count or skips
        // the marker: trim to a readable length instead of failing the turn.
        if (passage.length < 20) {
          const snippet = full.replace(/\s+/g, " ").trim().slice(0, 120);
          throw new Error(`Passage failed validation (length ${passage.length}; received ${full.length} chars: "${snippet}").`);
        }
        if (passage.length > 2000) {
          const cut = passage.slice(0, 2000);
          const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
          passage = (end > 500 ? cut.slice(0, end + 1) : cut).trim();
        }
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
