# skill: tool-call-discipline

## Aturan
1. Setiap tool call HARUS semua parameternya terisi penuh sebelum di-emit.
   Tidak ada "placeholder" / "nanti diisi".
2. Setelah 1 gagal pada tool yang sama: STOP, introspeksi penyebab
   (typo nama param? nilai kosong? format salah?), ganti pendekatan.
3. 2 gagal beruntun pada tool yang sama: STOP tool loop, laporkan ke
   user dengan text, jangan retry identik.
4. Jangan batch puluhan tool call kosong — satu call, diverifikasi,
   baru lanjut.
5. Jika gagal >3x, ganti tool lain (mis. view vs grep vs powershell)
   atau minta klarifikasi ke user.

## Deteksi loop
- Jika output tool berurutan sama (mis. "Invalid input: path Required"),
  HENTIKAN dan jelaskan ke user, jangan ulangi.