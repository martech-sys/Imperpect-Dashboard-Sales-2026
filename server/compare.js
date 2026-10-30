"use strict";

const { jamTeks } = require("./sesi");

/**
 * Tab Compare 2025: penjualan event 2026 (live) dibandingkan dengan Imperfect
 * Sale 2025, per hari dan per sesi.
 *
 * Angka 2025 tetap (hasil query manual atas laporan_penjualan, channel
 * IMPERFECT SALE 2025 + IMPERFECT SALE TEBUS MURAH, 20–23 Nov 2025), jadi
 * tidak membebani database. Dasar hitungnya disamakan untuk kedua tahun:
 *   GMV  = total bayar per invoice (MAX total_bayar, karena nilainya berulang
 *          di tiap baris produk) — BUKAN total_harga_barang seperti tab lain
 *   TRX  = jumlah invoice
 *   Unit = jumlah qty
 *   Sesi = jam mulai sesi s/d jam mulai sesi berikutnya; invoice ikut jam baris
 *          pertamanya.
 *
 * Hari dipasangkan menurut NAMA HARI (Jumat 2026 vs Jumat 2025, dst.), sesi
 * menurut JAM MULAI. Kamis 2025 tidak punya pasangan di 2026.
 */

const NAMA_HARI = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

const j = (h) => h * 60;

/** [jam mulai, jam selesai, nomor sesi, unit, trx, gmv] */
const BASELINE_2025 = {
  nama: "Imperfect Sale 2025",
  hari: [
    {
      tanggal: "2025-11-20",
      sesi: [
        [j(9), j(10), 1, 1830, 141, 224878000],
        [j(11), j(12), 2, 3500, 293, 425544000],
        [j(13), j(14), 3, 2125, 255, 282295000],
        [j(15), j(16), 4, 2128, 253, 305496400],
        [j(17), j(18), 5, 1751, 238, 267788200],
        [j(19), j(20), 6, 1810, 227, 282974000],
      ],
      luar: null,
    },
    {
      tanggal: "2025-11-21",
      sesi: [
        [j(9), j(10), 1, 2768, 245, 411451800],
        [j(13), j(14), 3, 2044, 217, 280673500],
        [j(15), j(16), 4, 2157, 244, 287027500],
        [j(17), j(18), 5, 2499, 284, 359459250],
        [j(19), j(20), 6, 1992, 285, 301990750],
      ],
      luar: [2, 2, 79000],
    },
    {
      tanggal: "2025-11-22",
      sesi: [
        [j(9), j(10), 1, 2337, 240, 342992250],
        [j(11), j(12), 2, 2331, 220, 336570250],
        [j(13), j(14), 3, 2571, 245, 377953250],
        [j(15), j(16), 4, 1925, 266, 282126750],
        [j(17), j(18), 5, 2474, 371, 344197000],
        [j(19), j(20), 6, 1808, 346, 248310750],
      ],
      luar: null,
    },
    {
      tanggal: "2025-11-23",
      sesi: [
        [j(9), j(10), 1, 2023, 241, 284982000],
        [j(11), j(12), 2, 2247, 304, 330875871],
        [j(13), j(14), 3, 1975, 288, 344854500],
        [j(15), j(16), 4, 1778, 370, 348073500],
        [j(17), j(18), 5, 1657, 365, 314416250],
        [j(19), j(20), 6, 2877, 598, 504865500],
      ],
      luar: null,
    },
  ],
};

const kosong = () => ({ unit: 0, trx: 0, gmv: 0 });

function tambah(a, b) {
  a.unit += b.unit;
  a.trx += b.trx;
  a.gmv += b.gmv;
  return a;
}

const total = (list) => list.reduce((a, b) => tambah(a, b), kosong());

const persen = (baru, lama) => (lama ? ((baru - lama) / lama) * 100 : null);

const aov = (v) => (v.trx ? Math.round(v.gmv / v.trx) : 0);

function namaHari(iso) {
  return NAMA_HARI[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

function tanggalKe(dari, hari) {
  const d = new Date(`${dari}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari - 1);
  return d.toISOString().slice(0, 10);
}

/** Tanggal & menit sekarang di WIB. */
function sekarangWib(nowMs) {
  const d = new Date(nowMs + 7 * 3600 * 1000);
  return {
    tanggal: d.toISOString().slice(0, 10),
    menit: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** Status satu potongan waktu [mulai, batas) pada tanggal tertentu. */
function statusPotongan(tanggal, mulai, batas, kini) {
  if (tanggal < kini.tanggal) return "selesai";
  if (tanggal > kini.tanggal) return "belum";
  if (kini.menit < mulai) return "belum";
  return kini.menit >= batas ? "selesai" : "berjalan";
}

/**
 * Satu baris per invoice: hari & sesi dari baris pertamanya, unit = jumlah
 * qty, GMV = total bayar terbesar.
 */
function perInvoice(rows) {
  const inv = new Map();
  rows.forEach((r, i) => {
    if (r.hari === null || r.hari === undefined) return;
    const kunci = r.invoice || `tanpa-invoice-${i}`;
    let v = inv.get(kunci);
    if (!v) {
      v = { hari: r.hari, sesi: r.sesi, menit: r.menit, unit: 0, gmv: 0 };
      inv.set(kunci, v);
    }
    const lebihAwal =
      r.hari < v.hari ||
      (r.hari === v.hari && (r.menit ?? Infinity) < (v.menit ?? Infinity));
    if (lebihAwal)
      Object.assign(v, { hari: r.hari, sesi: r.sesi, menit: r.menit });
    v.unit += r.qty || 0;
    v.gmv = Math.max(v.gmv, r.total_bayar || 0);
  });
  return [...inv.values()];
}

function compare(rows, event, opts = {}) {
  const kini = sekarangWib(opts.now ?? Date.now());

  // 2026: agregat per kunci sesi ("hari-nomor", "hari-0" = di luar sesi)
  const per26 = new Map();
  perInvoice(rows).forEach((v) => {
    if (!per26.has(v.sesi)) per26.set(v.sesi, kosong());
    tambah(per26.get(v.sesi), { unit: v.unit, trx: 1, gmv: v.gmv });
  });
  const ambil26 = (key) => ({ ...(per26.get(key) || kosong()) });

  const base = BASELINE_2025.hari.map((h) => ({
    ...h,
    nama: namaHari(h.tanggal),
  }));

  // Hari event 2026 menurut jadwal sesi
  const nomorHari = [...new Set(event.sesi.map((s) => s.hari))].sort(
    (a, b) => a - b,
  );
  const dipakai = new Set();

  const hari = nomorHari.map((h) => {
    const tanggal = tanggalKe(event.dari, h);
    const nama = namaHari(tanggal);
    const b = base.find((x) => x.nama === nama && !dipakai.has(x.tanggal));
    if (b) dipakai.add(b.tanggal);

    const sesi26 = event.sesi
      .filter((s) => s.hari === h)
      .sort((a, c) => a.mulai - c.mulai);
    const mulaiSemua = [
      ...new Set([
        ...sesi26.map((s) => s.mulai),
        ...(b ? b.sesi.map((s) => s[0]) : []),
      ]),
    ].sort((a, c) => a - c);

    const baris = mulaiSemua.map((mulai) => {
      const s26 = sesi26.find((s) => s.mulai === mulai);
      const s25 = b && b.sesi.find((s) => s[0] === mulai);
      const i26 = s26 ? sesi26.indexOf(s26) : -1;
      const batas = s26 && sesi26[i26 + 1] ? sesi26[i26 + 1].mulai : 24 * 60;
      const v25 = s25 ? { unit: s25[3], trx: s25[4], gmv: s25[5] } : kosong();
      const v26 = s26 ? ambil26(s26.key) : kosong();
      return {
        jam: `${jamTeks(mulai)}-${jamTeks(s26 ? s26.selesai : s25[1])}`,
        mulai,
        sesi2025: s25 ? `Sesi ${s25[2]}` : null,
        sesi2026: s26 ? `Sesi ${s26.nomor}` : null,
        status: s26
          ? statusPotongan(tanggal, mulai, batas, kini)
          : "tanpa-sesi",
        v25,
        v26,
        growthGmv: persen(v26.gmv, v25.gmv),
        growthTrx: persen(v26.trx, v25.trx),
        aov25: aov(v25),
        aov26: aov(v26),
      };
    });

    // Di luar sesi (sebelum sesi pertama) bila salah satu tahun punya isi
    const luar25 =
      b && b.luar
        ? { unit: b.luar[0], trx: b.luar[1], gmv: b.luar[2] }
        : kosong();
    const luar26 = ambil26(`${h}-0`);
    if (luar25.trx || luar26.trx) {
      baris.unshift({
        jam: "Di luar sesi",
        mulai: -1,
        sesi2025: null,
        sesi2026: null,
        status: statusPotongan(
          tanggal,
          0,
          sesi26.length ? sesi26[0].mulai : 24 * 60,
          kini,
        ),
        v25: luar25,
        v26: luar26,
        growthGmv: persen(luar26.gmv, luar25.gmv),
        growthTrx: persen(luar26.trx, luar25.trx),
        aov25: aov(luar25),
        aov26: aov(luar26),
        luarSesi: true,
      });
    }

    const v25 = total(baris.map((r) => r.v25));
    const v26 = total(baris.map((r) => r.v26));
    const jalan = baris.filter((r) => r.status === "selesai");
    const status =
      tanggal < kini.tanggal
        ? "selesai"
        : tanggal > kini.tanggal
          ? "belum"
          : "berjalan";
    return {
      hari: h,
      nama,
      tanggal2026: tanggal,
      tanggal2025: b ? b.tanggal : null,
      status,
      v25,
      v26,
      v25SampaiKini: total(jalan.map((r) => r.v25)),
      growthGmv: persen(v26.gmv, v25.gmv),
      growthTrx: persen(v26.trx, v25.trx),
      aov25: aov(v25),
      aov26: aov(v26),
      sesi: baris,
    };
  });

  // Hari 2025 tanpa pasangan (Kamis)
  const tanpaPasangan = base
    .filter((b) => !dipakai.has(b.tanggal))
    .map((b) => {
      const v = total(
        b.sesi.map((s) => ({ unit: s[3], trx: s[4], gmv: s[5] })),
      );
      if (b.luar)
        tambah(v, { unit: b.luar[0], trx: b.luar[1], gmv: b.luar[2] });
      // Rincian per sesi tetap dikirim supaya hari ini bisa ditampilkan
      // seperti hari lain, dengan kolom 2026 kosong.
      const sesi = b.sesi.map((s) => {
        const v25 = { unit: s[3], trx: s[4], gmv: s[5] };
        return {
          jam: `${jamTeks(s[0])}-${jamTeks(s[1])}`,
          mulai: s[0],
          sesi2025: `Sesi ${s[2]}`,
          sesi2026: null,
          status: "tanpa-pasangan",
          v25,
          v26: kosong(),
          growthGmv: null,
          growthTrx: null,
          aov25: aov(v25),
          aov26: 0,
        };
      });
      return {
        nama: b.nama,
        tanggal2025: b.tanggal,
        v25: v,
        aov25: aov(v),
        sesi,
      };
    });

  // Pembanding yang adil: hanya potongan sesi yang sudah selesai (sesi yang
  // sedang berjalan baru separuh jalan, sedangkan angka 2025 sudah penuh).
  const semuaBaris = hari.flatMap((h) => h.sesi);
  const selesai = semuaBaris.filter((r) => r.status === "selesai");
  const sampaiKini = {
    v25: total(selesai.map((r) => r.v25)),
    v26: total(selesai.map((r) => r.v26)),
    sesi: selesai.filter((r) => !r.luarSesi).length,
  };
  sampaiKini.growthGmv = persen(sampaiKini.v26.gmv, sampaiKini.v25.gmv);
  sampaiKini.growthTrx = persen(sampaiKini.v26.trx, sampaiKini.v25.trx);
  sampaiKini.growthUnit = persen(sampaiKini.v26.unit, sampaiKini.v25.unit);
  sampaiKini.aov25 = aov(sampaiKini.v25);
  sampaiKini.aov26 = aov(sampaiKini.v26);
  sampaiKini.growthAov = persen(sampaiKini.aov26, sampaiKini.aov25);

  const v26 = total(hari.map((h) => h.v26));
  const v25Pasangan = total(hari.map((h) => h.v25));
  const v25Semua = total([v25Pasangan, ...tanpaPasangan.map((t) => t.v25)]);
  const ringkas = {
    v26,
    v25Pasangan,
    v25Semua,
    progresPasangan: v25Pasangan.gmv ? (v26.gmv / v25Pasangan.gmv) * 100 : 0,
    progresSemua: v25Semua.gmv ? (v26.gmv / v25Semua.gmv) * 100 : 0,
  };

  return {
    tahunLalu: BASELINE_2025.nama,
    tanggal2025: {
      dari: BASELINE_2025.hari[0].tanggal,
      sampai: BASELINE_2025.hari[BASELINE_2025.hari.length - 1].tanggal,
    },
    sekarang: kini,
    hari,
    tanpaPasangan,
    sampaiKini,
    ringkas,
    insight: insight({ hari, sampaiKini, ringkas, tanpaPasangan }),
  };
}

const rupiah = (n) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

function rupiahRingkas(n) {
  const abs = Math.abs(n);
  const f = (x) => x.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  if (abs >= 1e9) return `Rp ${f(n / 1e9)} M`;
  if (abs >= 1e6) return `Rp ${f(n / 1e6)} jt`;
  return rupiah(n);
}

const pct = (x) =>
  `${x > 0 ? "+" : ""}${x.toLocaleString("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;

/** Kalimat ringkas yang dibaca dari angka di atas. */
function insight({ hari, sampaiKini, ringkas, tanpaPasangan }) {
  const out = [];
  const s = sampaiKini;
  const label = (h, r) => `${h.nama} ${r.jam}`;

  const baris = hari.flatMap((h) =>
    h.sesi.filter((r) => !r.luarSesi).map((r) => ({ h, r })),
  );
  const berjalan = baris.find(({ r }) => r.status === "berjalan");
  const kalimatBerjalan = berjalan
    ? `${label(berjalan.h, berjalan.r)} sedang berjalan: ${rupiahRingkas(berjalan.r.v26.gmv)} sejauh ini, sesi yang sama tahun lalu ${rupiahRingkas(berjalan.r.v25.gmv)}.`
    : null;

  if (!s.sesi) {
    out.push(
      kalimatBerjalan ||
        "Belum ada sesi 2026 yang selesai — perbandingan muncul begitu sesi pertama lewat.",
    );
    if (ringkas.v26.gmv)
      out.push(`GMV Net 2026 sejauh ini ${rupiahRingkas(ringkas.v26.gmv)}.`);
    return out;
  }

  out.push(
    `${s.sesi} sesi sudah selesai: GMV Net 2026 ${rupiahRingkas(s.v26.gmv)} vs ${rupiahRingkas(s.v25.gmv)} pada hari & sesi yang sama tahun lalu` +
      (s.growthGmv === null ? "." : ` (${pct(s.growthGmv)}).`),
  );
  if (s.growthTrx !== null && s.growthAov !== null) {
    out.push(
      `Transaksi ${s.v26.trx.toLocaleString("id-ID")} vs ${s.v25.trx.toLocaleString("id-ID")} (${pct(s.growthTrx)}); rata-rata belanja per TRX ${rupiah(s.aov26)} vs ${rupiah(s.aov25)} (${pct(s.growthAov)}).`,
    );
  }
  out.push(
    `Progres terhadap total 2025: ${ringkas.progresPasangan.toLocaleString("id-ID", { maximumFractionDigits: 1 })}% dari Jumat–Minggu 2025 (${rupiahRingkas(ringkas.v25Pasangan.gmv)}) dan ${ringkas.progresSemua.toLocaleString("id-ID", { maximumFractionDigits: 1 })}% dari seluruh event 2025 termasuk ${tanpaPasangan.map((t) => t.nama).join(", ") || "-"} (${rupiahRingkas(ringkas.v25Semua.gmv)}).`,
  );

  const selesai = baris.filter(({ r }) => r.status === "selesai");
  const terbaik = baris
    .filter(({ r }) => r.status !== "belum" && r.v26.gmv > 0)
    .sort((a, b) => b.r.v26.gmv - a.r.v26.gmv)[0];
  if (terbaik) {
    out.push(
      `Sesi 2026 dengan GMV Net tertinggi sejauh ini: ${label(terbaik.h, terbaik.r)} — ${rupiahRingkas(terbaik.r.v26.gmv)}` +
        (terbaik.r.growthGmv === null
          ? "."
          : ` (${pct(terbaik.r.growthGmv)} vs ${rupiahRingkas(terbaik.r.v25.gmv)} di 2025).`),
    );
  }
  const banding = selesai.filter(({ r }) => r.growthGmv !== null);
  if (banding.length >= 2) {
    const urut = [...banding].sort((a, b) => b.r.growthGmv - a.r.growthGmv);
    const naik = urut[0];
    const turun = urut[urut.length - 1];
    out.push(
      `Kenaikan terbesar di ${label(naik.h, naik.r)} (${pct(naik.r.growthGmv)}); ` +
        (turun.r.growthGmv < 0
          ? `penurunan terdalam di ${label(turun.h, turun.r)} (${pct(turun.r.growthGmv)}).`
          : `sesi selesai dengan pertumbuhan terkecil: ${label(turun.h, turun.r)} (${pct(turun.r.growthGmv)}).`),
    );
  }
  if (kalimatBerjalan) out.push(kalimatBerjalan);
  return out;
}

module.exports = { compare, perInvoice, BASELINE_2025 };
