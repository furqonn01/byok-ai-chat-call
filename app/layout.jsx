import "./globals.css";

export const metadata = {
  title: "BYOK Chat AI",
  description:
    "Chat AI Bring-Your-Own-Key dengan fitur call voice (speech-to-text + TTS)",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
