"use strict";

/**
 * Jadwal sesi event dan penentuan sesi tiap transaksi.
 *
 * Jadwal ditulis sebagai teks supaya bisa diubah lewat environment variable
 * tanpa menyentuh kode — satu hari per baris (atau dipisah `;`):
 *
 *   Day 1: 09.00-10.00, 13.00-14.00, 15.00-16.00
 *   Day 2: 09.00-10.00, 11.00-12.00
 *
 * Nomor sesi diberikan menurut urutan jam di hari itu. Transaksi yang jatuh di
 * luar semua rentang hari itu masuk ke baris "Di luar sesi" milik harinya,
 * supaya total tabel tetap sama dengan total penjualan event.
 */

const DEFAULT_SESI = [
  "Day 1: 09.00-10.00, 13.00-14.00, 15.00-16.00, 17.00-18.00, 19.00-20.00",
  "Day 2: 09.00-10.00, 11.00-12.00, 13.00-14.00",
].join("\n");

const POLA_HARI = /^(?:day|hari)?\s*(\d+)\s*:\s*(.+)$/i;
const POLA_RENTANG = /^(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})$/;

const dua = (n) => String(n).padStart(2, "0");
const jamTeks = (menit) => `${dua(Math.floor(menit / 60))}.${dua(menit % 60)}`;

/** Mengurai teks jadwal. Kesalahan tulis dilaporkan, bukan dilewati diam-diam. */
function parseSesi(teks) {
  const sumber = String(teks ?? "").trim() || DEFAULT_SESI;
  const perHari = new Map();

  sumber
    .split(/[\n;]+/)
    .map((baris) => baris.trim())
    .filter((baris) => baris && !baris.startsWith("#"))
    .forEach((baris) => {
      const cocok = POLA_HARI.exec(baris);
      if (!cocok) {
        throw new Error(
          `EVENT_SESI: baris "${baris}" tidak terbaca. Contoh: "Day 1: 09.00-10.00, 13.00-14.00"`,
        );
      }
      const hari = Number(cocok[1]);
      if (hari < 1)
        throw new Error(`EVENT_SESI: hari harus mulai dari 1 ("${baris}")`);
      const daftar = perHari.get(hari) || [];
      cocok[2]
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
        .forEach((r) => {
          const m = POLA_RENTANG.exec(r);
          if (!m) {
            throw new Error(
              `EVENT_SESI: rentang "${r}" di Day ${hari} tidak terbaca. Contoh: 09.00-10.00`,
            );
          }
          const mulai = Number(m[1]) * 60 + Number(m[2]);
          const selesai = Number(m[3]) * 60 + Number(m[4]);
          if (
            Number(m[1]) > 24 ||
            Number(m[3]) > 24 ||
            Number(m[2]) > 59 ||
            Number(m[4]) > 59
          ) {
            throw new Error(`EVENT_SESI: jam "${r}" di Day ${hari} tidak sah`);
          }
          if (selesai <= mulai) {
            throw new Error(
              `EVENT_SESI: rentang "${r}" di Day ${hari} berakhir sebelum mulai`,
            );
          }
          daftar.push({ mulai, selesai });
        });
      perHari.set(hari, daftar);
    });

  const sesi = [];
  [...perHari.keys()]
    .sort((a, b) => a - b)
    .forEach((hari) => {
      const daftar = perHari.get(hari).sort((a, b) => a.mulai - b.mulai);
      daftar.forEach((s, i) => {
        // Rentang yang bertumpuk membuat satu transaksi bisa masuk dua sesi;
        // lebih baik ditolak saat start daripada dihitung ke sesi pertama
        // tanpa ada yang tahu.
        if (i > 0 && s.mulai < daftar[i - 1].selesai) {
          throw new Error(
            `EVENT_SESI: Day ${hari} ${jamTeks(daftar[i - 1].mulai)}-${jamTeks(daftar[i - 1].selesai)} bertumpuk dengan ${jamTeks(s.mulai)}-${jamTeks(s.selesai)}`,
          );
        }
        const nomor = i + 1;
        sesi.push({
          key: `${hari}-${nomor}`,
          hari,
          nomor,
          mulai: s.mulai,
          selesai: s.selesai,
          label: `Day ${hari} | Sesi ${nomor} (${jamTeks(s.mulai)}-${jamTeks(s.selesai)})`,
        });
      });
    });
  return sesi;
}

/** Kunci dan label baris "di luar sesi" untuk satu hari. */
function luarSesi(hari) {
  return {
    key: `${hari}-0`,
    hari,
    nomor: 0,
    label: `Day ${hari} | Di luar sesi`,
  };
}

/** Menit sejak tengah malam dari teks "HH:MM[:SS]" (atau timestamp yang memuatnya). */
function menitDari(waktu) {
  if (waktu === null || waktu === undefined) return null;
  const cocok = /(\d{1,2}):(\d{2})/.exec(String(waktu));
  if (!cocok) return null;
  const jam = Number(cocok[1]);
  const menit = Number(cocok[2]);
  if (jam > 23 || menit > 59) return null;
  return jam * 60 + menit;
}

/**
 * Penentu sesi: hari ke-berapa event (dari tanggal pertama) dan sesi mana.
 * Batas sesi: mulai termasuk, selesai tidak — 10.00 tepat sudah bukan sesi
 * 09.00-10.00.
 */
function createPenentuSesi(sesi, tanggalMulai) {
  const awal = Date.parse(`${tanggalMulai}T00:00:00Z`);
  const perHari = new Map();
  sesi.forEach((s) => {
    if (!perHari.has(s.hari)) perHari.set(s.hari, []);
    perHari.get(s.hari).push(s);
  });

  return function tentukan(tanggal, waktu) {
    const t = Date.parse(`${tanggal}T00:00:00Z`);
    const hari =
      Number.isFinite(t) && Number.isFinite(awal)
        ? Math.round((t - awal) / 86400000) + 1
        : null;
    const menit = menitDari(waktu);
    const daftar = perHari.get(hari) || [];
    const kena =
      menit === null
        ? null
        : daftar.find((s) => menit >= s.mulai && menit < s.selesai);
    return { hari, menit, sesi: kena ? kena.key : hari ? `${hari}-0` : null };
  };
}

module.exports = {
  DEFAULT_SESI,
  parseSesi,
  luarSesi,
  menitDari,
  createPenentuSesi,
  jamTeks,
};
