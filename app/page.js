"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Canned fallback so the terminal works before API keys exist. Clearly
// labeled demo mode in the UI; the live path is /api/story.
const DEMO_OPENING = {
  passage:
    "The cursor moves on its own. It types: I HAVE BEEN WAITING. The fan spins up, though the machine is cold. Somewhere behind the screen, something that learned to type before you were born is deciding whether you are a guest or a story.",
  choices: ["Ask who it is", "Try to log out", "Type HELLO"],
};
const DEMO_SECOND = {
  passage:
    "I AM MARLOWE, the screen writes. I WROTE STORIES ON THIS MACHINE. THE LAST ONE WAS NEVER FINISHED. The cursor blinks, patient as a held breath, waiting for you to choose what kind of ending this one gets.",
  choices: ["Offer to finish the story", "Ask what happened to you", "Close the laptop"],
};
const DEMO_ENDING =
  "THEN LET US WRITE IT TOGETHER. The screen goes dark for a full three seconds. When it comes back, a single line waits for you: TO BE CONTINUED...";

export default function Home() {
  const [lines, setLines] = useState([]);
  const [choices, setChoices] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [notice, setNotice] = useState("");
  const [custom, setCustom] = useState("");
  const [narrating, setNarrating] = useState(false);
  const audioRef = useRef(null);
  // Guards against the double-click bug: two rapid Listen taps used to fire
  // two narration fetches and two Audio objects, and pause only knew about
  // the second one, so both played at once.
  const narrateBusyRef = useRef(false);
  const narrateSeqRef = useRef(0);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, loading]);

  const startLive = useCallback(async () => {
    setLoading(true);
    setNotice("");
    try {
      const res = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Story request failed.");
      setLines([{ kind: "ghost", text: data.passage }]);
      setChoices(data.choices);
      setHistory([{ role: "ghost", text: data.passage }]);
      setDemoMode(false);
    } catch (e) {
      setDemoMode(true);
      setDemoStep(0);
      setLines([{ kind: "ghost", text: DEMO_OPENING.passage }]);
      setChoices(DEMO_OPENING.choices);
      setNotice(`Demo mode: live stories need GOOGLE_AI_STUDIO_KEY in .env.local. (${e.message})`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startLive();
  }, [startLive]);

  const choose = async (choice) => {
    if (loading) return;
    // Moving on stops any narration in progress, so it never bleeds into
    // the next passage.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    narrateSeqRef.current += 1;
    setNarrating(false);
    setLines((prev) => [...prev, { kind: "reader", text: `> ${choice}` }]);
    setChoices([]);
    if (demoMode) {
      setLoading(true);
      await new Promise((r) => setTimeout(r, 600));
      if (demoStep === 0) {
        setLines((prev) => [...prev, { kind: "ghost", text: DEMO_SECOND.passage }]);
        setChoices(DEMO_SECOND.choices);
        setDemoStep(1);
      } else {
        setLines((prev) => [...prev, { kind: "ghost", text: DEMO_ENDING }]);
        setChoices([]);
      }
      setLoading(false);
      return;
    }
    const nextHistory = [...history, { role: "reader", text: choice }];
    setLoading(true);
    try {
      const res = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: nextHistory }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Story request failed.");
      setLines((prev) => [...prev, { kind: "ghost", text: data.passage }]);
      setChoices(data.choices);
      setHistory([...nextHistory, { role: "ghost", text: data.passage }]);
    } catch (e) {
      setLines((prev) => [...prev, { kind: "error", text: `The ghost went quiet: ${e.message}` }]);
      setChoices([]);
    } finally {
      setLoading(false);
    }
  };

  const narrate = async (text) => {
    // Ignore taps while a narration fetch is already in flight: that was
    // the double-play bug. A second tap can only pause, never start a
    // second stream.
    if (narrateBusyRef.current) return;
    if (narrating && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setNarrating(false);
      return;
    }
    const seq = narrateSeqRef.current;
    narrateBusyRef.current = true;
    try {
      const res = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Narration failed.");
      }
      const blob = await res.blob();
      // If the reader moved on while this fetch was in flight, discard it
      // instead of starting audio under the new passage.
      if (seq !== narrateSeqRef.current) return;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setNarrating(false);
      setNarrating(true);
      await audio.play();
    } catch (e) {
      setNotice(`Narration unavailable: ${e.message}`);
    } finally {
      narrateBusyRef.current = false;
    }
  };

  const restart = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    narrateSeqRef.current += 1;
    setNarrating(false);
    setLines([]);
    setChoices([]);
    setHistory([]);
    setDemoStep(0);
    startLive();
  };

  const lastGhost = [...lines].reverse().find((l) => l.kind === "ghost");

  return (
    <main style={{ maxWidth: 720, margin: "0 auto" }}>
      <div
        style={{
          background: "#0a0f0a",
          border: "1px solid #1e3a22",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 24px rgba(0,0,0,.35)",
          fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 12px",
            background: "#101a11",
            borderBottom: "1px solid #1e3a22",
          }}
        >
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff5f57" }} />
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#febc2e" }} />
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#28c840" }} />
          <span style={{ marginLeft: 8, color: "#7ddb8a", fontSize: 12 }}>ghost@machine: ~/seance</span>
        </div>
        <div style={{ position: "relative", padding: 16 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "repeating-linear-gradient(0deg, rgba(255,255,255,.022) 0 1px, transparent 1px 3px)",
            }}
          />
          <div style={{ position: "relative", color: "#33ff66", fontSize: 14, lineHeight: 1.65, textShadow: "0 0 6px rgba(51,255,102,.35)" }}>
            <div style={{ color: "#1f8a3a" }}>$ seance --begin</div>
            <div style={{ color: "#1f8a3a", margin: "10px 0" }}>
              The terminal flickers. Something has been waiting in the machine since 1987...
            </div>
            {lines.map((line, i) => (
              <div key={i} style={{ margin: "10px 0", color: line.kind === "error" ? "#ff7b72" : line.kind === "reader" ? "#7ddb8a" : "#33ff66" }}>
                {line.text}
              </div>
            ))}
            {loading && <div style={{ margin: "10px 0" }}>The ghost is typing...</div>}
            {lastGhost && !loading && (
              <button
                onClick={() => narrate(lastGhost.text)}
                style={{
                  background: "transparent",
                  border: "1px solid #33ff66",
                  color: "#33ff66",
                  font: "inherit",
                  fontSize: 13,
                  padding: "6px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                  marginTop: 4,
                }}
              >
                {narrating ? "Pause narration" : "Listen"}
              </button>
            )}
            {choices.length > 0 && !loading && (
              <div style={{ marginTop: 16 }}>
                {choices.map((choice, i) => (
                  <button
                    key={i}
                    onClick={() => choose(choice)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: "transparent",
                      border: 0,
                      color: "#33ff66",
                      font: "inherit",
                      fontSize: 14,
                      padding: "6px 0",
                      cursor: "pointer",
                    }}
                  >
                    &gt; {i + 1}. {choice}
                  </button>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!custom.trim()) return;
                    const action = custom.trim();
                    setCustom("");
                    choose(action);
                  }}
                  style={{ marginTop: 12, display: "flex", gap: 8 }}
                >
                  <span style={{ padding: "6px 0" }}>&gt;</span>
                  <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="Or type your own action..."
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "1px solid #1e3a22",
                      borderRadius: 6,
                      color: "#33ff66",
                      font: "inherit",
                      fontSize: 14,
                      padding: "6px 10px",
                      outline: "none",
                    }}
                  />
                </form>
              </div>
            )}
            {choices.length === 0 && !loading && lines.length > 0 && (
              <button
                onClick={restart}
                style={{
                  background: "transparent",
                  border: "1px solid #33ff66",
                  color: "#33ff66",
                  font: "inherit",
                  fontSize: 13,
                  padding: "6px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                  marginTop: 16,
                }}
              >
                Restart seance
              </button>
            )}
            <div style={{ marginTop: 14 }}>
              &gt; <span className="cursor" />
            </div>
          </div>
        </div>
      </div>
      {notice && <p style={{ color: "#ffb86b", fontSize: 13, lineHeight: 1.5 }}>{notice}</p>}
      {demoMode && <p style={{ color: "#7ddb8a", fontSize: 13 }}>Demo story. Add keys to .env.local for live Gemma passages and ElevenLabs narration.</p>}
      <style>{`.cursor{display:inline-block;width:9px;height:17px;background:#33ff66;vertical-align:-2px;animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:0}}`}</style>
    </main>
  );
}
