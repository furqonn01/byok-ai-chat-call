import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PROVIDERS = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  custom: null,
};

/**
 * GET /api/models?provider=openai&apiKey=...&baseUrl=...
 * Return list model yang tersedia dari provider (endpoint /models).
 *
 * Query params:
 * - provider: openai | openrouter | groq | mistral | custom
 * - apiKey: string (wajib)
 * - baseUrl: string (hanya untuk provider custom)
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider") || "openai";
  const apiKey = searchParams.get("apiKey");
  const baseUrl = searchParams.get("baseUrl");

  if (!apiKey) {
    return NextResponse.json(
      { error: "API key wajib diisi" },
      { status: 400 }
    );
  }

  let base = baseUrl;
  if (!base) {
    base = PROVIDERS[provider];
    if (!base) {
      return NextResponse.json(
        { error: "Provider tidak dikenal. Isi baseUrl untuk provider custom." },
        { status: 400 }
      );
    }
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://byok-chat.local";
    headers["X-Title"] = "BYOK Chat AI";
  }

  const res = await fetch(`${base}/models`, {
    method: "GET",
    headers,
  }).catch((e) => {
    throw new Error(`Gagal ambil model: ${e.message}`);
  });

  if (!res.ok) {
    const errText = await res.text();
    let errMsg = errText;
    try {
      const parsed = JSON.parse(errText);
      errMsg = parsed.error?.message || parsed.message || errMsg;
    } catch {
      /* keep raw */
    }
    return NextResponse.json(
      { error: `Provider error (${res.status}): ${errMsg}` },
      { status: 502 }
    );
  }

  const data = await res.json();
  // Normalisasi: sebagian provider return array, sebagian { data: [] }
  const list = Array.isArray(data) ? data : data.data || [];
  const models = list
    .map((m) => (typeof m === "string" ? m : m.id))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return NextResponse.json({ models, provider });
}
