const title = "Haunted Terminal";
const description = "A ghost in the machine tells you a story. You choose what happens next.";

// Absolute URLs for og:image and og:url. Vercel sets VERCEL_PROJECT_PRODUCTION_URL;
// SITE_URL overrides it (for a custom domain), and local dev falls back to localhost.
const siteUrl =
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: { title, description, url: "/", siteName: title, type: "website", locale: "en_US" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport = { themeColor: "#070907" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#070907", padding: "24px 12px", fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
