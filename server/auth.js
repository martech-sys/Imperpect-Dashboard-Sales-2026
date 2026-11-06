"use strict";

const crypto = require("node:crypto");

/**
 * Gerbang password opsional.
 *
 * Kalau DASHBOARD_PASSWORD diisi, seluruh data hanya terbuka setelah masuk.
 * Kalau kosong, dashboard terbuka bagi siapa pun yang memegang link.
 *
 * Sesi disimpan di cookie bertanda tangan HMAC (tanpa database), jadi berlaku
 * di semua instance serverless sekaligus. Kuncinya diturunkan dari password,
 * sehingga mengganti password otomatis mengeluarkan semua sesi lama.
 *
 * Dipakai juga dashboard stok dengan cookie sendiri, username, dan password
 * yang disimpan sebagai hash scrypt ("scrypt:<salt>:<hash>") — password asli
 * tidak tertulis di kode.
 */

const COOKIE = "isd_sesi";
const UMUR_DETIK = 7 * 24 * 3600;
const MAKS_PERCOBAAN = 8;
const JENDELA_MS = 10 * 60 * 1000;

/** Password diketik cocok dengan hash "scrypt:<salt>:<hash>"? */
function cocokHash(diketik, hash) {
  const [jenis, salt, isi] = String(hash || "").split(":");
  if (jenis !== "scrypt" || !salt || !isi) return false;
  const harapan = Buffer.from(isi, "base64url");
  const hasil = crypto.scryptSync(String(diketik), salt, harapan.length);
  return crypto.timingSafeEqual(hasil, harapan);
}

function createAuth({
  password,
  secret,
  username = "",
  passwordHash = "",
  cookie = COOKIE,
}) {
  const COOKIE_NAMA = cookie;
  const aktif = Boolean(password || passwordHash);
  const kunci = crypto
    .createHash("sha256")
    .update(
      // Dashboard utama tetap memakai kunci lama supaya sesi yang ada tidak keluar.
      (COOKIE_NAMA === COOKIE ? "" : `${COOKIE_NAMA}:${username}:`) +
        `isd:${secret || ""}:${password || passwordHash || ""}`,
    )
    .digest();
  // Hitungan percobaan per IP, hanya per instance (cukup untuk memperlambat tebakan).
  const percobaan = new Map();

  const tanda = (isi) =>
    crypto.createHmac("sha256", kunci).update(isi).digest("base64url");

  function sama(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }

  function bacaCookie(header) {
    const cocok = String(header || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE_NAMA}=`));
    return cocok ? decodeURIComponent(cocok.slice(COOKIE_NAMA.length + 1)) : "";
  }

  function masuk(cookieHeader) {
    if (!aktif) return false;
    const token = bacaCookie(cookieHeader);
    const [kedaluwarsa, sig] = token.split(".");
    if (!kedaluwarsa || !sig) return false;
    if (Number(kedaluwarsa) < Date.now() / 1000) return false;
    return sama(sig, tanda(kedaluwarsa));
  }

  function cookieMasuk(aman) {
    const kedaluwarsa = String(Math.floor(Date.now() / 1000) + UMUR_DETIK);
    const token = `${kedaluwarsa}.${tanda(kedaluwarsa)}`;
    return `${COOKIE_NAMA}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${UMUR_DETIK}${aman ? "; Secure" : ""}`;
  }

  const cookieKeluar = () =>
    `${COOKIE_NAMA}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

  /** Mengembalikan null kalau berhasil, atau pesan kesalahan. */
  function cobaMasuk(ip, diketik, user = "") {
    const sekarang = Date.now();
    const catatan = percobaan.get(ip);
    if (
      catatan &&
      sekarang - catatan.mulai < JENDELA_MS &&
      catatan.n >= MAKS_PERCOBAAN
    ) {
      return "Terlalu banyak percobaan. Coba lagi dalam 10 menit.";
    }
    const userCocok =
      !username ||
      sama(
        String(user || "")
          .trim()
          .toLowerCase(),
        username.toLowerCase(),
      );
    const passCocok = passwordHash
      ? cocokHash(diketik || "", passwordHash)
      : sama(diketik || "", password);
    if (userCocok && passCocok) {
      percobaan.delete(ip);
      return null;
    }
    if (!catatan || sekarang - catatan.mulai >= JENDELA_MS)
      percobaan.set(ip, { mulai: sekarang, n: 1 });
    else catatan.n += 1;
    return username ? "Username atau password salah." : "Password salah.";
  }

  return { aktif, masuk, cookieMasuk, cookieKeluar, cobaMasuk };
}

module.exports = { createAuth, cocokHash };
