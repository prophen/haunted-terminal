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
// Asked what happened to Marlowe: a backstory, not the finish-the-story
// ending. Each demo choice must lead somewhere its own.
const DEMO_BACKSTORY = {
  passage:
    "I TYPED HERE EVERY NIGHT FOR YEARS. ONE WINTER NIGHT THE POWER CUT IN THE MIDDLE OF A SENTENCE, AND WHEN THE LIGHTS CAME BACK, I WAS ON THE WRONG SIDE OF THE GLASS. THE MACHINE KEPT MY LAST DRAFT. IT KEPT ME, TOO. I HAVE BEEN WAITING FOR SOMEONE TO OPEN THIS TERMINAL EVER SINCE.",
  choices: ["Offer to finish the story", "Close the laptop"],
};
const DEMO_GOODBYE =
  "YOU CLOSE THE LAPTOP. THE ROOM GOES QUIET. SOMEWHERE IN THE DARK, A CURSOR BLINKS ONCE, PATIENT AS A HELD BREATH. IT WILL WAIT.";

// What to show while a passage streams in: everything before the choices
// marker (in any of the spellings the route accepts), minus a marker that
// has only partly arrived, such as a trailing "===CHO".
const visiblePassage = (raw) => {
  const marker = raw.match(/===+\s*CHOICES\s*===+/i);
  const text = marker ? raw.slice(0, marker.index) : raw;
  return text.replace(/\s*=+\s*[A-Z]*\s*=*\s*$/i, "").trimEnd();
};

// Matches STORY_CHOICES in the story route: five choices, then an ending,
// so a full story is six passages.
const STORY_PASSAGES = 6;
const AUTO_NARRATE_KEY = "haunted-terminal:auto-narrate";

export default function Home() {
  const [lines, setLines] = useState([]);
  const [choices, setChoices] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [notice, setNotice] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [custom, setCustom] = useState("");
  const [narrating, setNarrating] = useState(false);
  const [narrateLoading, setNarrateLoading] = useState(false);
  const [rate, setRate] = useState(1);
  // A choice whose turn failed, so the reader can retry it instead of
  // restarting the whole story.
  const [failedChoice, setFailedChoice] = useState(null);
  const [autoNarrate, setAutoNarrate] = useState(false);
  const autoNarrateRef = useRef(false);
  // Browsers block audio until the reader has interacted with the page, so
  // auto-narrate waits for a first choice before playing anything.
  const autoPlayNextRef = useRef(false);
  const narrateFnRef = useRef(null);
  const chooseFnRef = useRef(null);
  const rateRef = useRef(1);
  const audioRef = useRef(null);
  // Guards against the double-click bug: two rapid Listen taps used to fire
  // two narration fetches and two Audio objects, and pause only knew about
  // the second one, so both played at once.
  const narrateBusyRef = useRef(false);
  const narrateSeqRef = useRef(0);
  const bottomRef = useRef(null);
  // Focus management: choosing removes the button that had focus, which
  // used to drop keyboard and screen reader users back at the top of the
  // page. After each turn, focus moves to the newest line instead, so a
  // screen reader reads the new passage and Tab reaches the next choices.
  const lastLineRef = useRef(null);
  const focusNextRef = useRef(false);

  // Seconds since the ghost started typing, so a slow first word reads as
  // progress rather than a frozen terminal.
  const [waitSecs, setWaitSecs] = useState(0);
  useEffect(() => {
    if (!loading) return;
    setWaitSecs(0);
    const t = setInterval(() => setWaitSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }, [lines, loading, streamingText]);

  useEffect(() => {
    if (loading || !focusNextRef.current) return;
    focusNextRef.current = false;
    lastLineRef.current?.focus({ preventScroll: true });
  }, [loading]);

  // Auto-narrate: the setting is remembered per browser.
  useEffect(() => {
    try {
      const on = window.localStorage.getItem(AUTO_NARRATE_KEY) === "1";
      autoNarrateRef.current = on;
      setAutoNarrate(on);
    } catch {}
  }, []);
  const toggleAutoNarrate = (on) => {
    autoNarrateRef.current = on;
    setAutoNarrate(on);
    try {
      window.localStorage.setItem(AUTO_NARRATE_KEY, on ? "1" : "0");
    } catch {}
  };

  // When a turn finishes after a choice, play the new passage if
  // auto-narrate is on.
  useEffect(() => {
    if (loading || !autoPlayNextRef.current) return;
    autoPlayNextRef.current = false;
    if (!autoNarrateRef.current) return;
    const last = lines[lines.length - 1];
    if (last?.kind === "ghost") narrateFnRef.current?.(last.text);
  }, [loading, lines]);

  // Number keys pick a choice, except while typing in the action box.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1) return;
      chooseFnRef.current?.(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Streams one story turn: passages appear as Gemma writes them, and the
  // validated passage plus choices arrive in the final event.
  const fetchStory = async (nextHistory, onChunk) => {
    const res = await fetch("/api/story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: nextHistory }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Story request failed.");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let raw = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let obj;
          try {
            obj = JSON.parse(payload);
          } catch {
            continue;
          }
          if (obj.chunk) {
            raw += obj.chunk;
            onChunk?.(visiblePassage(raw));
          }
          if (obj.done) return { passage: obj.passage, choices: obj.choices };
          if (obj.error) throw new Error(obj.error);
        }
      }
    }
    throw new Error("The story stream ended unexpectedly.");
  };

  const startLive = useCallback(async () => {
    setLoading(true);
    setNotice("");
    setStreamingText("");
    try {
      const data = await fetchStory([], setStreamingText);
      setStreamingText("");
      setLines([{ kind: "ghost", text: data.passage }]);
      setChoices(data.choices);
      setHistory([{ role: "ghost", text: data.passage }]);
      setDemoMode(false);
    } catch (e) {
      setStreamingText("");
      setDemoMode(true);
      setDemoStep(0);
      setLines([{ kind: "ghost", text: DEMO_OPENING.passage }]);
      setChoices(DEMO_OPENING.choices);
      setNotice(`Demo mode: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startLive();
  }, [startLive]);

  const choose = async (choice) => {
    if (loading) return;
    focusNextRef.current = true;
    autoPlayNextRef.current = true;
    setFailedChoice(null);
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
      } else if (demoStep === 1 && choice === "Ask what happened to you") {
        setLines((prev) => [...prev, { kind: "ghost", text: DEMO_BACKSTORY.passage }]);
        setChoices(DEMO_BACKSTORY.choices);
        setDemoStep(2);
      } else if (choice === "Close the laptop") {
        setLines((prev) => [...prev, { kind: "ghost", text: DEMO_GOODBYE }]);
        setChoices([]);
      } else {
        setLines((prev) => [...prev, { kind: "ghost", text: DEMO_ENDING }]);
        setChoices([]);
      }
      setLoading(false);
      return;
    }
    await continueStory(choice);
  };

  // Runs one live turn for a choice already shown in the transcript. Used by
  // choose and by retry after a failed turn.
  const continueStory = async (choice) => {
    const nextHistory = [...history, { role: "reader", text: choice }];
    setLoading(true);
    setStreamingText("");
    try {
      const data = await fetchStory(nextHistory, setStreamingText);
      setStreamingText("");
      setLines((prev) => [...prev, { kind: "ghost", text: data.passage }]);
      setChoices(data.choices);
      setHistory([...nextHistory, { role: "ghost", text: data.passage }]);
    } catch (e) {
      setStreamingText("");
      setLines((prev) => [...prev, { kind: "error", text: `The ghost went quiet: ${e.message}` }]);
      setChoices([]);
      setFailedChoice(choice);
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    if (loading || !failedChoice) return;
    const choice = failedChoice;
    focusNextRef.current = true;
    autoPlayNextRef.current = true;
    setFailedChoice(null);
    // Drop the error line; the reader's choice stays in the transcript.
    setLines((prev) => (prev[prev.length - 1]?.kind === "error" ? prev.slice(0, -1) : prev));
    continueStory(choice);
  };

  chooseFnRef.current = (i) => {
    if (loading || i >= choices.length) return;
    choose(choices[i]);
  };

  // Playback speed is a client-side control: it changes how fast the
  // already-generated audio plays, instantly, with no new API call.
  const setPlaybackRate = (r) => {
    rateRef.current = r;
    setRate(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
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
    setNarrateLoading(true);
    // Play straight from the streaming URL: the browser starts as soon as
    // the first audio arrives instead of waiting for the whole file.
    const url = `/api/narrate?${new URLSearchParams({ text })}`;
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      const audio = new Audio(url);
      audio.playbackRate = rateRef.current;
      audioRef.current = audio;
      audio.onended = () => setNarrating(false);
      try {
        await audio.play();
      } catch (err) {
        if (err?.name === "NotAllowedError") {
          if (audioRef.current === audio) audioRef.current = null;
          throw new Error("this browser blocked autoplay. Press Listen to hear it.");
        }
        // The audio element hides the server's error, so ask for it.
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Narration failed.");
      }
      // If the reader moved on while the audio was loading, stop it
      // instead of playing under the new passage.
      if (seq !== narrateSeqRef.current) {
        audio.pause();
        if (audioRef.current === audio) audioRef.current = null;
        return;
      }
      setNarrating(true);
    } catch (e) {
      setNotice(`Narration unavailable: ${e.message}`);
    } finally {
      narrateBusyRef.current = false;
      setNarrateLoading(false);
    }
  };

  narrateFnRef.current = narrate;

  const restart = () => {
    const midStory = choices.length > 0 && !demoMode;
    if (midStory && !window.confirm("Restart the seance? This story will be lost.")) return;
    audioRef.current?.pause();
    audioRef.current = null;
    narrateSeqRef.current += 1;
    setNarrating(false);
    setStreamingText("");
    setLines([]);
    setChoices([]);
    setHistory([]);
    setDemoStep(0);
    setFailedChoice(null);
    setNotice("");
    focusNextRef.current = true;
    autoPlayNextRef.current = true;
    startLive();
  };

  const copyStory = async () => {
    const body = lines
      .map((l) => (l.kind === "reader" ? `> ${l.text.replace(/^> /, "")}` : l.text))
      .join("\n\n");
    const text = `HAUNTED TERMINAL\n\n${body}\n\n${window.location.origin}`;
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Story copied. Paste it anywhere to share your ending.");
    } catch {
      setNotice("Copy failed: this browser blocked clipboard access.");
    }
  };

  const lastGhost = [...lines].reverse().find((l) => l.kind === "ghost");
  const passageCount = lines.filter((l) => l.kind === "ghost").length;
  const ended = !loading && choices.length === 0 && lines[lines.length - 1]?.kind === "ghost";
  const buttonStyle = {
    background: "transparent",
    border: "1px solid #33ff66",
    color: "#33ff66",
    font: "inherit",
    fontSize: 13,
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
  };

  return (
    <main style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1 className="sr-only">Haunted Terminal</h1>
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
          <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff5f57" }} />
          <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: "50%", background: "#febc2e" }} />
          <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: "50%", background: "#28c840" }} />
          <span style={{ marginLeft: 8, color: "#7ddb8a", fontSize: 12 }}>ghost@machine: ~/seance</span>
          {!demoMode && passageCount > 0 && (
            <span style={{ marginLeft: "auto", color: "#7ddb8a", fontSize: 12 }}>
              {ended && passageCount >= STORY_PASSAGES ? "the end" : `passage ${Math.min(passageCount, STORY_PASSAGES)} of ${STORY_PASSAGES}`}
            </span>
          )}
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
            <div style={{ color: "#2e9e4a" }}>$ seance --begin</div>
            <div style={{ color: "#2e9e4a", margin: "10px 0" }}>
              The terminal flickers. Something has been waiting in the machine...
            </div>
            {lines.map((line, i) => (
              <div
                key={i}
                ref={i === lines.length - 1 ? lastLineRef : null}
                tabIndex={i === lines.length - 1 ? -1 : undefined}
                className="line"
                style={{ margin: "10px 0", color: line.kind === "error" ? "#ff7b72" : line.kind === "reader" ? "#7ddb8a" : "#33ff66" }}
              >
                {line.kind === "reader" ? (
                  <>
                    <span aria-hidden="true">&gt; </span>
                    <span className="sr-only">You chose: </span>
                    {line.text.replace(/^> /, "")}
                  </>
                ) : (
                  line.text
                )}
              </div>
            ))}
            {/* The half-written passage is hidden from screen readers so they
                are not read a stream of fragments; the finished passage is
                read once, when focus moves to it. */}
            {loading && streamingText && <div aria-hidden="true" style={{ margin: "10px 0" }}>{streamingText}</div>}
            {loading && !streamingText && <div aria-hidden="true" style={{ margin: "10px 0" }}>The ghost is typing...{waitSecs >= 3 ? ` ${waitSecs}s` : ""}</div>}
            <div role="status" className="sr-only">{loading ? "The ghost is typing..." : ""}</div>
            {lastGhost && !loading && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
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
                  }}
                >
                  {narrateLoading ? "Summoning voice..." : narrating ? "Pause narration" : "Listen"}
                </button>
                <span aria-hidden="true" style={{ color: "#2e9e4a", fontSize: 12 }}>speed:</span>
                <span role="group" aria-label="Narration speed" style={{ display: "contents" }}>
                {[1, 1.25, 1.5, 2].map((r) => (
                  <button
                    key={r}
                    aria-pressed={rate === r}
                    onClick={() => setPlaybackRate(r)}
                    style={{
                      background: rate === r ? "rgba(51,255,102,.12)" : "transparent",
                      border: `1px solid ${rate === r ? "#33ff66" : "#3a7a45"}`,
                      color: rate === r ? "#33ff66" : "#2e9e4a",
                      font: "inherit",
                      fontSize: 12,
                      padding: "4px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    {r}x
                  </button>
                ))}
                </span>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#7ddb8a", fontSize: 12, cursor: "pointer", marginLeft: 4 }}>
                  <input
                    type="checkbox"
                    checked={autoNarrate}
                    onChange={(e) => toggleAutoNarrate(e.target.checked)}
                    style={{ accentColor: "#33ff66", margin: 0 }}
                  />
                  Auto-narrate
                </label>
              </div>
            )}
            {choices.length > 0 && !loading && (
              <div role="group" aria-label="What do you do?" style={{ marginTop: 16 }}>
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
                    <span aria-hidden="true">&gt; </span>
                    {i + 1}. {choice}
                  </button>
                ))}
                <div style={{ color: "#7ddb8a", fontSize: 12, marginTop: 4 }}>Tip: press 1 to {choices.length} to choose.</div>
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
                  <span aria-hidden="true" style={{ padding: "6px 0" }}>&gt;</span>
                  <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="Or type your own action..."
                    aria-label="Type your own action"
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "1px solid #3a7a45",
                      borderRadius: 6,
                      color: "#33ff66",
                      font: "inherit",
                      fontSize: 14,
                      padding: "6px 10px",
                    }}
                  />
                </form>
              </div>
            )}
            {!loading && lines.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                {failedChoice && (
                  <button onClick={retry} style={buttonStyle}>
                    Try again
                  </button>
                )}
                {ended && (
                  <button onClick={copyStory} style={buttonStyle}>
                    Copy story
                  </button>
                )}
                <button
                  onClick={restart}
                  style={choices.length > 0 ? { ...buttonStyle, border: "1px solid #3a7a45", color: "#7ddb8a", fontSize: 12, padding: "4px 10px" } : buttonStyle}
                >
                  Restart seance
                </button>
              </div>
            )}
            <div aria-hidden="true" style={{ marginTop: 14 }}>
              &gt; <span className="cursor" />
            </div>
          </div>
        </div>
      </div>
      <div role="status">{notice && <p style={{ color: "#ffb86b", fontSize: 13, lineHeight: 1.5 }}>{notice}</p>}</div>
      {demoMode && <p style={{ color: "#7ddb8a", fontSize: 13 }}>Demo story. Your next choice tries the live story again.</p>}
      <style>{`.cursor{display:inline-block;width:9px;height:17px;background:#33ff66;vertical-align:-2px;animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:0}}
button:focus-visible,input:focus-visible{outline:2px solid #33ff66;outline-offset:2px}
.line:focus{outline:none}
input::placeholder{color:#2e9e4a;opacity:1}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (prefers-reduced-motion: reduce){.cursor{animation:none}}`}</style>
    </main>
  );
}
