// ElevenLabs text-to-speech, mirrored from Talk to the Book (app/api/narrate).
// One passage read aloud at a time; passages are short, so the cap is small.

const MAX_CHARS = 2000;

export async function POST(req) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Missing ELEVENLABS_API_KEY. Add it to .env.local to hear passages read aloud." },
      { status: 500 }
    );
  }

  let text;
  let voiceId;
  try {
    const body = await req.json();
    text = String(body.text ?? "").trim();
    voiceId = String(body.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM");
    if (!text) throw new Error("empty");
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  } catch {
    return Response.json({ error: "Send { text, voiceId? } with the passage to narrate." }, { status: 400 });
  }

  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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

  if (!upstream.ok) {
    const detail = await upstream.text();
    return Response.json({ error: "ElevenLabs narration failed.", detail: detail.slice(0, 300) }, { status: 502 });
  }

  const audio = await upstream.arrayBuffer();
  return new Response(audio, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
