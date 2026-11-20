# BYOK Chat — Agent Instructions

## Tool-calling failure recovery

Ketika tool call gagal (skema mismatch, `invalid_type`, `expected string, received object/undefined`):

1. **Recovery otomatis**: retry tool call 1x dengan argumen yang sudah diperbaiki (coerce object → string, JSON.stringify untuk content, isi field undefined dari context).
2. **Max 2 retry per tool**. Kalau masih gagal → laporkan error ke user dengan:
   - tool name + error message verbatim
   - argumen yang gagal
   - saran fix
3. **Jangan** loop tanpa batas. Jangan coba tool lain untuk tujuan yang sama tanpa konfirmasi user.
4. **Model yang lemah tool-calling** (qwen3-coder lama, GLM, model local via llama.cpp < 2.3.0):
   - Patch opencode dengan `z.preprocess((v) => typeof v === "object" && v !== null ? JSON.stringify(v, null, 2) : v, z.string())` di `write.ts`/`edit.ts`
   - Atau upgrade llama.cpp ≥ 2.3.0 (fix duplicate keys + streaming)
   - Atau pakai proxy: `florath/qwen3-call-patch-proxy`
5. **Jangan** commit workaround ke repo user; hanya apply jika user minta.

## Umum

- Proyek Next.js di `E:\Project\BYOK chat`.
- Pakai `node`/`npm` untuk build.
- Jangan buat file markdown perencanaan kecuali diminta.
