# PLAN: BYOK Chat AI — Streaming, Model List, IndexedDB, Multi-Device

Proyek: Next.js 15 di `E:\Project\BYOK chat`. Sudah ada: chat BYOK (OpenAI/OpenRouter/Groq/Mistral/Custom), vision (image_url), STT+TTS (Web Speech API), Call modal hands-free. Build produksi lulus.

## Tujuan
1. Streaming respons AI (SSE)
2. Daftar model dinamis dari provider
3. DB lokal browser (IndexedDB via Dexie) — persist konversasi + settings per-perangkat
4. Multi-device / responsif penuh — sidebar jadi drawer di layar kecil

## File yang Perlu Dicek / Disentuh

| File | Status | Aksi |
|---|---|---|
| `components/chat-app.jsx` | Ada, belum wiring baru | Rewrite (paling besar) |
| `components/call-modal.jsx` | Ada | Tidak ubah |
| `app/api/chat/route.js` | Ada, sudah support `stream:true` | Tidak ubah |
| `app/api/models/route.js` | Cek ada | Buat jika belum |
| `lib/db.js` | Cek ada | Buat jika belum |
| `lib/persistence.js` | Cek ada | Buat jika belum |
| `lib/use-speech-recognition.js` | Ada | Tidak ubah |
| `lib/use-speech-synthesis.js` | Ada | Tidak ubah |
| `app/globals.css` | Cek ada style drawer | Tambah jika belum |
| `package.json` | Cek ada dexie | Tambah jika belum |

### Cek cepat (jalankan dulu)
```
ls E:/Project/BYOK\ chat/lib
ls E:/Project/BYOK\ chat/app/api
grep dexie E:/Project/BYOK\ chat/package.json
grep -c "sidebar.open" E:/Project/BYOK\ chat/app/globals.css
```

## Konten File yang Belum Ada (copy-paste)

### 1. `lib/db.js`
```js
import Dexie from "dexie";

const db = new Dexie("byok-chat", { version: 1 });
db.version(1).stores({
  conversations: "id, updatedAt, title",
  settings: "key",
});

export const Conversations = db.table("conversations");
export const Settings = db.table("settings");
export default db;

// Helper: bulkDelete yang kompatibel dengan Dexie
export function bulkDelete(table, ids) {
  return table.bulkDelete(ids);
}
```

### 2. `lib/persistence.js`
```js
"use client";
import { useEffect, useRef } from "react";
import { Conversations, Settings } from "./db";

export const SETTINGS_KEY = "byok-settings";

export async function saveSettings(settings) {
  try { await Settings.put({ key: SETTINGS_KEY, value: settings }); }
  catch (e) { console.warn("Gagal simpan settings:", e); }
}

export async function loadSettings(defaults) {
  try {
    const row = await Settings.get(SETTINGS_KEY);
    if (row?.value) return { ...defaults, ...row.value };
  } catch (e) { console.warn("Gagal muat settings:", e); }
  return defaults;
}

export async function saveConversations(conversations) {
  try {
    const now = Date.now();
    await Conversations.bulkPut(conversations.map((c) => ({ ...c, updatedAt: now })));
  } catch (e) { console.warn("Gagal simpan konversasi:", e); }
}

export async function loadConversations() {
  try {
    return await Conversations.orderBy("updatedAt").reverse().toArray();
  } catch (e) { console.warn("Gagal muat konversasi:", e); return []; }
}

export async function deleteConversation(id) {
  try { await Conversations.delete(id); }
  catch (e) { console.warn("Gagal hapus konversasi:", e); }
}

export async function deleteConversationByDate(date, providerKey) {
  try {
    const now = Date.now();
    const all = await Conversations.orderBy("updatedAt").reverse().toArray();
    const toDelete = all.filter((c) =>
      c.date === date && (!providerKey || c.providerKey === providerKey)
    );
    await Conversations.bulkDelete(toDelete.map((c) => c.id));
  } catch (e) { console.warn("Gagal hapus konversasi per tanggal:", e); }
}

export async function deleteAllConversations() {
  try {
    const all = await Conversations.toArray();
    await Conversations.bulkDelete(all.map((c) => c.id));
  } catch (e) { console.warn("Gagal hapus semua konversasi:", e); }
}

export function groupConversationsByDate(conversations) {
  const groups = {};
  for (const c of conversations) {
    const d = c.date || "unknown";
    if (!groups[d]) groups[d] = [];
    groups[d].push(c);
  }
  return groups;
}

export function usePersistence({ conversations, settings, loaded }) {
  const skipFirstRef = useRef(true);
  useEffect(() => {
    if (!loaded) return;
    if (skipFirstRef.current) { skipFirstRef.current = false; return; }
    saveConversations(conversations);
  }, [conversations, loaded]);
  useEffect(() => {
    if (!loaded) return;
    saveSettings(settings);
  }, [settings, loaded]);
}
```

### 3. `app/api/models/route.js`
```js
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PROVIDERS = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  custom: null,
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider") || "openai";
  const apiKey = searchParams.get("apiKey");
  const baseUrl = searchParams.get("baseUrl");

  if (!apiKey) return NextResponse.json({ error: "API key wajib diisi" }, { status: 400 });

  let base = baseUrl;
  if (!base) {
    base = PROVIDERS[provider];
    if (!base) return NextResponse.json({ error: "Provider tidak dikenal. Isi baseUrl untuk custom." }, { status: 400 });
  }

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://byok-chat.local";
    headers["X-Title"] = "BYOK Chat AI";
  }

  try {
    const res = await fetch(`${base}/models`, { method: "GET", headers });
    if (!res.ok) {
      const errText = await res.text();
      let errMsg = errText;
      try { const p = JSON.parse(errText); errMsg = p.error?.message || p.message || errMsg; } catch {}
      return NextResponse.json({ error: `Provider error (${res.status}): ${errMsg}` }, { status: 502 });
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.data || [];
    const models = list.map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ models, provider });
  } catch (e) {
    return NextResponse.json({ error: `Gagal ambil model: ${e.message}` }, { status: 500 });
  }
}
```

### 4. `package.json` — tambah deps (jika belum ada)
```json
"dexie": "^4.0.8",
"dexie-react-hooks": "^1.1.7"
```
Lalu: `npm install`

### 5. `app/globals.css` — tambah (jika belum ada)
```css
.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 40;
}

.menu-toggle {
  display: none;
}

@media (max-width: 760px) {
  .sidebar {
    position: fixed;
    top: 0; left: 0; bottom: 0;
    width: 280px;
    z-index: 41;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
  }
  .sidebar.open { transform: translateX(0); }
  .sidebar-backdrop.show { display: block; }
  .menu-toggle { display: inline-flex; }
  .message { max-width: 85%; }
  .call-card { width: 92%; }
}

@media (max-width: 480px) {
  .sidebar { width: 85vw; }
  .composer .icon-btn { width: 40px; height: 40px; font-size: 16px; }
  .composer textarea { min-height: 40px; }
}
```

## Rewrite `components/chat-app.jsx`

Import:
```jsx
import {
  saveSettings, loadSettings, saveConversations,
  loadConversations, deleteConversation,
  deleteConversationByDate, deleteAllConversations,
  groupConversationsByDate, usePersistence,
} from "@/lib/persistence";
```

State baru:
- `streaming: bool`
- `sidebarOpen: bool`
- `loaded: bool` (data awal dari IDB sudah masuk)
- `modelList: string[]`, `modelLoading: bool`
- `abortRef`, `streamTextRef` (ref)

Mount effect:
```jsx
useEffect(() => {
  (async () => {
    const [s, c] = await Promise.all([
      loadSettings(DEFAULT_SETTINGS),
      loadConversations(),
    ]);
    setSettings(s);
    setConversations(c);
    setLoaded(true);
  })();
}, []);

usePersistence({ conversations, settings, loaded });
```

Hapus persistensi `localStorage` lama (`useEffect` yang `localStorage.setItem`).

Helper `fetchModels`:
```jsx
const fetchModels = useCallback(async () => {
  if (!settings.apiKey) return;
  setModelLoading(true);
  try {
    const q = new URLSearchParams({
      provider: settings.provider,
      apiKey: settings.apiKey,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
    });
    const res = await fetch(`/api/models?${q}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal ambil model");
    setModelList(data.models);
  } catch (e) {
    setError(e.message);
  } finally {
    setModelLoading(false);
  }
}, [settings]);
```

Helper `streamSend`:
```jsx
const streamSend = useCallback(async (conversationId, apiMessages) => {
  abortRef.current = new AbortController();
  setStreaming(true);
  let full = "";

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortRef.current.signal,
    body: JSON.stringify({
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages: apiMessages,
      temperature: 0.7,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE lines dipisah \n
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) {
          full += delta;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conversationId
                ? { ...c, messages: [ ...c.messages.slice(0, -1), { role: "assistant", content: full } ] }
                : c
            )
          );
        }
      } catch { /* partial line */ }
    }
  }

  setConversations((prev) =>
    prev.map((c) =>
      c.id === conversationId
        ? { ...c, messages: [ ...c.messages.slice(0, -1), { role: "assistant", content: full || "(respon kosong)" } ] }
        : c
    )
  );
  return full;
}, [settings]);
```

Ubah `send()`:
- Ganti `fetch` non-stream dengan:
  ```jsx
  // Tambahkan placeholder asisten kosong dulu
  setConversations(prev => prev.map(c => c.id === conversationId
    ? { ...c, messages: [...c.messages, { role: "assistant", content: "" }] }
    : c));

  try {
    const reply = await streamSend(conversationId, apiMessages);
    if (settings.autoSpeak && reply) speak(reply, { voiceURI: settings.voiceURI, rate: settings.speechRate });
    return reply;
  } catch (err) {
    if (err.name === "AbortError") { /* dibatalkan user */ }
    else {
      setError(err.message);
      setConversations(prev => prev.map(c => c.id === conversationId
        ? { ...c, messages: [ ...c.messages.slice(0, -1), { role: "error", content: err.message } ] }
        : c));
    }
  } finally {
    setStreaming(false);
    setLoading(false);
  }
  ```

UI baru:
- Header: tombol hamburger `<button className="menu-toggle btn" onClick={() => setSidebarOpen(true)}>☰</button>` (hanya muncul di mobile via CSS)
- Sidebar class: `className={sidebarOpen ? "sidebar open" : "sidebar"}`
- Backdrop: `<div className={sidebarOpen ? "sidebar-backdrop show" : "sidebar-backdrop"} onClick={() => setSidebarOpen(false)} />` (di depan sidebar dalam `.body`)
- Sidebar, seksi model: input model ganti jadi `<input list="model-options" ...>` + `<datalist id="model-options">{modelList.map(m => <option key={m} value={m} />)}</datalist>`
- Tambah tombol "🔄 Fetch Models" (disabled saat `modelLoading` atau tidak ada `apiKey`)
- Di sidebar, tiap konversasi: tambah tombol kecil "🗑" → `deleteConversation(c.id)` + `setConversations(prev => prev.filter(x => x.id !== c.id))`
- Saat `streaming`: di composer, tombol "Kirim" berubah jadi "⏹ Stop" → `abortRef.current?.abort()`
- Di messages: saat `streaming` dan pesan terakhir asisten belum jadi, tampilkan kursor `▍` di ujung teks
- Di sidebar, tambah seksi "Riwayat" di bawah daftar konversasi:
  - Tombol "📂 Riwayat" → buka panel riwayat (dropdown di sidebar atau modal)
  - Panel riwayat: daftar tanggal yang digroup via `groupConversationsByDate(conversations)`
  - Tiap tanggal: label tanggal + jumlah konversasi di bawahnya
  - Tombol "🗑️ Hapus" per tanggal → `deleteConversationByDate(dateKey)` + refresh state
  - Tombol "🗑️ Hapus Semua" → `deleteAllConversations()` + refresh state + konfirmasi
  - Tombol "↩️ Buka" per konversasi → `setConversations(prev => prev.map(c => c.id === id ? c : c).filter(c => c.id === id)); setActiveConversationId(id); setSidebarOpen(false);`
- Di sidebar, tambah seksi "Umpan Balik":
  - Tombol "💬 Beri Umpan Balik" → buka modal feedback
  - Tombol "⭐ Rate App" → buka modal rate (bintang 1-5 + teks opsional, POST ke `/api/feedback`)
  - Tombol "🛟 Dukungan" → buka modal dukungan (link ke email/website support, teks deskripsi singkat)

### Modal Feedback
```jsx
const [feedbackOpen, setFeedbackOpen] = useState(false);
const [feedback, setFeedback] = useState({ text: "", email: "", rating: 0 });

const submitFeedback = async () => {
  if (!feedback.text.trim()) return;
  await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(feedback),
  });
  setFeedbackOpen(false);
  setFeedback({ text: "", email: "", rating: 0 });
};
```
Modal: textarea untuk umpan balik, input email opsional, input rating (bintang 1-5), tombol submit.

### Modal Rate
```jsx
const [rateOpen, setRateOpen] = useState(false);
const [rating, setRating] = useState(0);

const submitRate = async () => {
  await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating, type: "rate" }),
  });
  setRateOpen(false);
  setRating(0);
};
```
Modal: 5 tombol bintang (klik untuk set rating), teks "Terima kasih atas rating Anda!", tombol submit.

### Modal Dukungan
```jsx
const [supportOpen, setSupportOpen] = useState(false);
```
Modal: teks deskripsi singkat, link email support, link website/FAQ, tombol tutup.

## Test Checklist
- [ ] Buka DevTools → device mobile (≤760px) → sidebar jadi drawer, hamburger muncul, backdrop menutup
- [ ] Isi API key OpenAI/Groq → klik "Fetch Models" → model list terisi di datalist
- [ ] Pilih model + kirim pesan → teks muncul per-chunk (streaming)
- [ ] Refresh halaman → konversasi & settings tetap ada (IndexedDB, cek DevTools → Application → IndexedDB)
- [ ] Hapus 1 konversasi → hilang dari daftar + IDB
- [ ] Call mode: greeting TTS → selesai
- [ ] `npx next build` lulus
- [ ] `npx next dev` → GET / 200, tanpa hydration error
- [ ] Sidebar → seksi "Riwayat" muncul, daftar tanggal tergroup dari `groupConversationsByDate`
- [ ] Hapus per tanggal → konversasi di tanggal itu hilang dari IDB + state
- [ ] Hapus semua → semua konversasi hilang, konfirmasi dialog muncul
- [ ] Buka riwayat → pilih konversasi lama → chat terbuka di panel utama
- [ ] Sidebar → seksi "Umpan Balik" muncul
- [ ] Klik "💬 Beri Umpan Balik" → modal buka, isi textarea + rating → submit → modal tutup
- [ ] Klik "⭐ Rate App" → modal buka, klik bintang → submit → modal tutup
- [ ] Klik "🛟 Dukungan" → modal buka, link email + website terlihat, tutup
- [ ] `POST /api/feedback` → response 200, data tersimpan di `feedbacks` table (cek SQLite dev.db)

## Aturan Tool-Call (dari `.skills/skill-edit.md`)
- 1 tool gagal → introspeksi, ganti pendekatan
- 2 gagal sama → stop tool, laporkan user
- 3+ gagal → ganti tool lain atau minta klarifikasi
- Jangan batch puluhan tool call kosong
- Hydration: state tergantung `window`/IDB harus via `useEffect` setelah mount, bukan initializer
- Setelah edit `chat-app.jsx`: selalu `npx next build` verifikasi

## Estimasi
- Rewrite chat-app: ~150 baris perubahan
- Test: 5–10 menit
- Total: 20–30 menit

## Status saat ini

**Sudah sukses:**
- ✅ `lib/db.js`, `lib/persistence.js`, `app/api/models/route.js`, `app/api/chat/route.js` (stream), CSS drawer — semua sudah ada & benar
- ✅ Dexie + dexie-react-hooks di package.json
- ✅ Backup `components/chat-app.jsx.bak`
- ✅ Edit 1: hapus `streamTextRef`
- ✅ Edit 2: hapus block `localStorage` + `STORAGE_KEY` (bug undefined)

**Sisa plan yang belum dikerjakan (di `chat-app.jsx`):**
- Tambah helper `fetchModels` + `streamSend`
- Ganti `send()` pakai streaming + placeholder asisten
- UI: hamburger, sidebar class `open`, backdrop, datalist model, tombol Fetch Models, tombol 🗑 per konversasi, Stop button saat streaming, kursor `▍`
- Verifikasi: `npx next build`

## Catatan kegagalan

Alasan kegagalan edit barusan: saya membatalkan sendiri panggilan `edit` berikutnya (tidak jadi emit), bukan tool error. Saya ragu apakah ingin lanjut sekarang atau mau Anda tinjau dulu perubahan `send()` yang akan rewrite.

Lanjut eksekusi sisa edit + build, atau mau saya tunjukkan dulu potongan `streamSend`/`send()` finalnya?