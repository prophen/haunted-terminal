import { ImageResponse } from "next/og";

export const alt = "Haunted Terminal: a ghost in the machine tells you a story. You choose what happens next.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const green = "#33ff66";
const dim = "#7ddb8a";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#070907", padding: 48, fontFamily: "monospace" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#0a0f0a", border: "2px solid #1e3a22", borderRadius: 20, boxShadow: "0 0 80px rgba(51,255,102,0.18)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 24px", background: "#101a11", borderBottom: "2px solid #1e3a22", borderRadius: "18px 18px 0 0" }}>
            <div style={{ width: 18, height: 18, borderRadius: 9, background: "#ff5f57" }} />
            <div style={{ width: 18, height: 18, borderRadius: 9, background: "#febc2e" }} />
            <div style={{ width: 18, height: 18, borderRadius: 9, background: "#28c840" }} />
            <div style={{ marginLeft: 16, color: "#3a7a45", fontSize: 24 }}>marlowe@haunted:~</div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 64px", color: green }}>
            <div style={{ fontSize: 30, color: "#3a7a45" }}>$ ./summon --story</div>
            <div style={{ fontSize: 96, fontWeight: 700, marginTop: 20, textShadow: "0 0 24px rgba(51,255,102,0.6)" }}>HAUNTED TERMINAL</div>
            <div style={{ fontSize: 34, color: dim, marginTop: 24, lineHeight: 1.4 }}>
              A ghost in the machine tells you a story.
            </div>
            <div style={{ display: "flex", fontSize: 34, color: dim, lineHeight: 1.4 }}>
              You choose what happens next.
              <div style={{ width: 20, height: 38, background: green, marginLeft: 12, marginTop: 4 }} />
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
