# BYOK Chat AI

Chat AI **Bring-Your-Own-Key** dengan fitur **call** (voice: speech-to-text +
text-to-speech) dan **vision** (lampirkan gambar).

Dibangun dengan Next.js (App Router) + React.

## Fitur

- **BYOK**: user input API key sendiri (OpenAI, OpenRouter, Groq, Mistral, atau
  endpoint OpenAI-compatible custom). Key disimpan di IndexedDB browser,
  **tidak** melewati server apa pun selain provider tujuan.
- **Streaming**: balasan AI muncul per-chunk via SSE, bisa dihentikan (Stop).
- **Model dinamis**: tombol Fetch Models mengambil daftar model dari provider.
- **Chat**: multi-konversasi, riwayat per tanggal, system prompt.
- **Responsif**: sidebar jadi drawer di layar ≤760px.
- **Vision**: lampirkan 1+ gambar; dikirim sebagai `image_url` (format
  OpenAI-compatible).
- **STT**: mic → teks (Web Speech API: `SpeechRecognition`).
- **TTS**: balasan AI → suara (Web Speech API: `speechSynthesis`), pilih voice
  & rate.
- **Mode Call**: simulasi telepon hands-free — greeting otomatis, TTS selesai
  → STT nyala, timer durasi, animasi waveform.

## Menjalankan

```bash
npm install
npm run dev
```

Buka http://localhost:3000, isi API key di panel kiri, pilih provider & model,
lalu chat / mic / Call.

> STT/TTS butuh browser dengan Web Speech API: Chrome, Edge, atau Safari.
> Mic butuh izin akses.

## Struktur

| Path | Peran |
| --- | --- |
| `app/page.jsx` | Halaman utama (shell) |
| `app/layout.jsx` | Root layout |
| `components/chat-app.jsx` | UI chat + sidebar + komposer |
| `components/call-modal.jsx` | UI mode Call |
| `lib/use-speech-recognition.js` | Hook STT |
| `lib/use-speech-synthesis.js` | Hook TTS |
| `lib/db.js` | Skema IndexedDB (Dexie) |
| `lib/persistence.js` | Simpan/muat konversasi & settings |
| `lib/feedback-db.js` | Tabel SQLite `feedbacks` |
| `app/api/chat/route.js` | Proxy BYOK → provider (API key user) |
| `app/api/models/route.js` | Ambil daftar model provider |
| `app/api/feedback/route.js` | Simpan & baca umpan balik |
| `app/globals.css` | Styling |

## API Proxy

`POST /api/chat` meneruskan ke provider yang dipilih:

```json
{
  "provider": "openai",
  "baseUrl": "https://api.contoh.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "Halo" }],
  "temperature": 0.7,
  "stream": false
}
```

Provider default: `openai`, `openrouter`, `groq`, `mistral`, atau `custom`
(isi `baseUrl`).

## Catatan

- Vision memakai format `image_url` (base64 data URL dari file) — kompatibel
  dengan OpenAI / OpenRouter / Groq model vision.
- TTS memakai `speechSynthesis` bawaan browser (offline, tanpa API key).
- STT memakai `SpeechRecognition` bawaan browser (Chrome/Edge/Safari).
