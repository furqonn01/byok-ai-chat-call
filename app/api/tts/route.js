/**
 * GET /api/tts?text=...&lang=id
 *
 * Proxy ke Google Translate TTS (suara Google) agar tidak kena CORS.
 * Google membatasi ~200 karakter per request, jadi teks dipecah per kalimat
 * lalu MP3-nya disambung.
 *
 * Fallback client: bila route ini gagal, hook memakai Web Speech API.
 */

export const dynamic = "force-dynamic";

const MAX_CHARS = 190; // aman di bawah batas 200
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Pecah teks jadi potongan <= MAX_CHARS, utamakan batas kalimat/kata. */
function chunkText(text) {
  const chunks = [];
  let rest = text.replace(/\s+/g, " ").trim();

  while (rest.length > MAX_CHARS) {
    let cut = -1;
    const win = rest.slice(0, MAX_CHARS + 1);
    for (const sep of [". ", "! ", "? ", "; ", ", ", " "]) {
      const idx = win.lastIndexOf(sep);
      if (idx > MAX_CHARS * 0.4) {
        cut = idx + sep.length;
        break;
      }
    }
    if (cut <= 0) cut = MAX_CHARS;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function fetchChunk(text, lang) {
  const url =
    "https://translate.google.com/translate_tts" +
    `?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}` +
    `&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://translate.google.com/" },
  });
  if (!res.ok) {
    throw new Error(`Google TTS ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const text = (searchParams.get("text") || "").trim();
  const lang = searchParams.get("lang") || "id";

  if (!text) {
    return new Response(JSON.stringify({ error: "text wajib diisi" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const chunks = chunkText(text);
    const buffers = [];
    // Berurutan agar tidak dibatasi Google; maksimal 12 potongan (~2300 char)
    for (const chunk of chunks.slice(0, 12)) {
      buffers.push(await fetchChunk(chunk, lang));
    }
    const audio = Buffer.concat(buffers);

    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
