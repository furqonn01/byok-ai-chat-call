import { NextResponse } from "next/server";

/**
 * API BYOK: client mengirim API key + provider config, server meneruskan
 * ke provider (OpenAI-compatible) dengan key milik user.
 *
 * Body:
 * {
 *   provider: "openai" | "openrouter" | "groq" | "custom",
 *   apiKey: string,
 *   model: string,
 *   messages: [{ role, content }],
 *   temperature?: number,
 *   maxTokens?: number
 * }
 */
export const dynamic = "force-dynamic";

const PROVIDERS = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  custom: null, // user isi baseUrl
};

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      provider,
      apiKey,
      model,
      messages,
      baseUrl,
      temperature,
      maxTokens,
      stream = false,
    } = body;

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key wajib diisi (BYOK: user harus bawa key sendiri)" },
        { status: 400 }
      );
    }

    let base = baseUrl;
    if (!base) {
      base = PROVIDERS[provider];
      if (!base) {
        return NextResponse.json(
          { error: "Provider tidak dikenal. Pilih provider atau isi baseUrl." },
          { status: 400 }
        );
      }
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    // OpenRouter butuh header referensi (opsional tapi disarankan)
    if (provider === "openrouter") {
      headers["HTTP-Referer"] =
        typeof window !== "undefined" ? window.location.origin : "https://byok-chat.local";
      headers["X-Title"] = "BYOK Chat AI";
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens,
        stream,
      }),
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
        { status: res.status === 401 ? 401 : 502 }
      );
    }

    if (stream) {
      // Teruskan stream SSE dari provider
      return new NextResponse(res.body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: `Server error: ${err.message}` },
      { status: 500 }
    );
  }
}
