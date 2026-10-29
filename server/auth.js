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
 */

const COOKIE = "isd_sesi";
const UMUR_DETIK = 7 * 24 * 3600;
const MAKS_PERCOBAAN = 8;
const JENDELA_MS = 10 * 60 * 1000;

function createAuth({ password, secret }) {
  const aktif = Boolean(password);
  const kunci = crypto
    .createHash("sha256")
    .update(`isd:${secret || ""}:${password || ""}`)
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
      .find((s) => s.startsWith(`${COOKIE}=`));
    return cocok ? decodeURIComponent(cocok.slice(COOKIE.length + 1)) : "";
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
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${UMUR_DETIK}${aman ? "; Secure" : ""}`;
  }

  const cookieKeluar = () =>
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

  /** Mengembalikan null kalau berhasil, atau pesan kesalahan. */
  function cobaMasuk(ip, diketik) {
    const sekarang = Date.now();
    const catatan = percobaan.get(ip);
    if (
      catatan &&
      sekarang - catatan.mulai < JENDELA_MS &&
      catatan.n >= MAKS_PERCOBAAN
    ) {
      return "Terlalu banyak percobaan. Coba lagi dalam 10 menit.";
    }
    if (sama(diketik || "", password)) {
      percobaan.delete(ip);
      return null;
    }
    if (!catatan || sekarang - catatan.mulai >= JENDELA_MS)
      percobaan.set(ip, { mulai: sekarang, n: 1 });
    else catatan.n += 1;
    return "Password salah.";
  }

  return { aktif, masuk, cookieMasuk, cookieKeluar, cobaMasuk };
}

module.exports = { createAuth };
