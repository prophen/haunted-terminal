import { gemmaStream } from "@/lib/gemma";

// Server-sent events: one { chunk } event per piece of text as Gemma writes
// it, then one { done, passage, choices } event once the route has
// validated the marker shape. The client shows chunks as they arrive.
export const dynamic = "force-dynamic";

const SYSTEM = `You write a branching spooky story set at an old computer
terminal. The reader is "you": they sit at the terminal, and every passage
describes what they see, hear, and do, in second person, present tense.

Marlowe is a ghost who lives inside the terminal. He was a writer who typed
stories on this machine until one winter night, when the power cut out
mid-sentence and left him trapped on the wrong side of the glass. He wants
someone to help him finish his last story. Marlowe never narrates. He only
speaks by typing on the screen, and his words always appear in CAPITALS,
for example: The cursor moves on its own. It types: WHO IS THERE?

Keep the story coherent: each passage follows directly from the previous
one and from the reader's choice, nothing happens without a cause, and
details stay consistent (the room, the machine, what Marlowe has said).

Rules:
- Spooky, never gory. No graphic violence, no real-world tragedy, no jump
  scares described in graphic detail. Eerie and playful, PG.
- Each passage is 80 to 130 words. Narration is always second person
  ("you"); first person ("I") appears only inside Marlowe's CAPITALS.
- Never use em dashes. Use commas, periods, or colons instead.
- Never break character or mention being an AI.
- Never claim anything in the story is real. It is fiction.
- Choices are short actions the reader takes, written as commands
  (for example: Type HELLO, Unplug the machine, Ask what happened).
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
      ? "The reader has just switched on an old terminal they found. Begin the story: something stirs on the screen, and Marlowe types his first words."
      : history.map((h) => `${h.role === "reader" ? "Reader chose" : "Passage"}: ${h.text}`).join("\n");

  const user = `${storySoFar}\n\nContinue the story: write the next passage, then ${MARKER}, then exactly 3 choices, one per line.`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Ignore writes after the reader has gone (tab closed, restart).
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {}
      };
      try {
        const t0 = Date.now();
        let firstMs = null;
        let full = "";
        for await (const chunk of gemmaStream(SYSTEM, user)) {
          firstMs ??= Date.now() - t0;
          full += chunk;
          send({ chunk });
        }
        // Timing lands in the server log (Vercel's function logs), which is
        // where to look if a turn feels slow again.
        console.log(`story: first text after ${firstMs}ms, done after ${Date.now() - t0}ms, ${full.length} chars`);
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
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps gzip (next start, proxies) from buffering the
      // stream; X-Accel-Buffering does the same for nginx-style proxies.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
