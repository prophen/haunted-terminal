export const metadata = {
  title: "Haunted Terminal",
  description: "A ghost in the machine tells you a story. You choose what happens next.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#070907", padding: "24px 12px", fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
