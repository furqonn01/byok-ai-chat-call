import "./globals.css";
import "bootstrap-icons/font/bootstrap-icons.css";

export const metadata = {
  title: "Sharkie AI Chat-Call",
  description:
    "Chat AI multi-provider dengan streaming, vision, dan panggilan suara (STT + Google TTS)",
  applicationName: "Sharkie AI Chat-Call",
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Sharkie AI", statusBarStyle: "default" },
  openGraph: {
    title: "Sharkie AI Chat-Call",
    description: "Chat AI multi-provider dengan streaming, vision, dan panggilan suara",
    type: "website",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
