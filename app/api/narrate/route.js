// ElevenLabs text-to-speech, mirrored from Talk to the Book (app/api/narrate).
// One passage read aloud at a time; passages are short, so the cap is small.

const MAX_CHARS = 2000;
// Overridable so a local mock can stand in for ElevenLabs when testing.
const ELEVEN_BASE = process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io";

// Streams the audio through as ElevenLabs generates it, so playback can
// start after the first chunk instead of after the whole passage. GET
// exists so an <audio> element can play the stream directly from its URL.
export async function GET(req) {
  const params = new URL(req.url).searchParams;
  return narrate(params.get("text"), params.get("voiceId"));
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return narrate(body.text, body.voiceId);
}

async function narrate(rawText, rawVoiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Missing ELEVENLABS_API_KEY. Add it to .env.local to hear passages read aloud." },
      { status: 500 }
    );
  }

  let text = String(rawText ?? "").trim();
  const voiceId = String(rawVoiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM");
  if (!text) {
    return Response.json({ error: "Send { text, voiceId? } with the passage to narrate." }, { status: 400 });
  }
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

  const upstream = await fetch(`${ELEVEN_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.2,
        speed: 0.97,
        use_speaker_boost: true,
      },
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return Response.json({ error: "ElevenLabs narration failed.", detail: detail.slice(0, 300) }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store, no-transform" },
  });
}
