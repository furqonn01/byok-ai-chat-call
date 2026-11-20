import { NextResponse } from "next/server";
import { insertFeedback, listFeedback } from "@/lib/feedback-db";

export const dynamic = "force-dynamic";

/**
 * POST /api/feedback
 * Body: { text?, email?, rating?, type? }
 * type: "feedback" (default) | "rate"
 *
 * Simpan umpan balik ke tabel `feedbacks` di SQLite (dev.db).
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { text, email, rating, type = "feedback" } = body;

    // Validasi minimal
    if (type === "feedback" && !text?.trim()) {
      return NextResponse.json({ error: "Umpan balik tidak boleh kosong" }, { status: 400 });
    }
    if (type === "rate" && (!rating || rating < 1 || rating > 5)) {
      return NextResponse.json({ error: "Rating harus 1-5" }, { status: 400 });
    }

    const record = {
      id: "fb-" + Date.now().toString(36),
      type,
      text: text || "",
      email: email || "",
      rating: rating || 0,
      createdAt: new Date().toISOString(),
      userAgent: req.headers.get("user-agent") || "",
    };

    insertFeedback(record);

    return NextResponse.json({ ok: true, id: record.id });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * GET /api/feedback — lihat semua umpan balik (untuk admin/dev).
 */
export async function GET() {
  try {
    return NextResponse.json({ feedbacks: listFeedback() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
