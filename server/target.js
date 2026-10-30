"use strict";

/**
 * Target penjualan Imperfect Sale 2026 per brand (GMV), dibagi ke tiap sesi
 * event dengan dua cara:
 *   - rata         : target ÷ jumlah sesi 2026
 *   - proporsional : target × porsi GMV Net sesi pasangannya di 2025
 *                    (hari & jam yang sama), sehingga sesi yang tahun lalu
 *                    ramai mendapat target lebih besar.
 *
 * Aktual per brand = jumlah total_harga_barang (sama dengan GMV menu lain).
 * Proporsi sesi tetap memakai GMV Net 2025 (satu-satunya angka 2025 yang
 * tersedia). Nama brand dicocokkan tanpa memedulikan huruf besar/kecil,
 * spasi, dan tanda baca (principal_brand).
 */

const TARGET_2026 = [
  {
    kategori: "Menswear",
    brands: [
      ["HEYMALE", 617553044],
      ["PREPPSTUDIO", 259983120],
      ["NOSTALGY", 108780064],
      ["ZOMA BASIC", 13683772],
    ],
  },
  {
    kategori: "Womenswear",
    brands: [
      ["HEYLOCAL", 3813000000],
      ["SHUWA MODEST", 205000000],
      ["BOONABOO", 64782902],
    ],
  },
];

const kunciBrand = (nama) =>
  String(nama || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * GMV per brand per sesi = jumlah total_harga_barang barisnya (harga sebelum
 * diskon), sama dengan GMV di menu Sesi × Channel. Sesi mengikuti jam tiap
 * baris. → Map kunci sesi → Map kunci brand → { nama, gmv }
 */
function gmvBrandPerSesi(rows) {
  const hasil = new Map();
  rows.forEach((r) => {
    if (!r.sesi) return;
    if (!hasil.has(r.sesi)) hasil.set(r.sesi, new Map());
    const perBrand = hasil.get(r.sesi);
    const k = kunciBrand(r.brand);
    if (!perBrand.has(k)) perBrand.set(k, { nama: r.brand, gmv: 0 });
    perBrand.get(k).gmv += r.total_harga_barang || 0;
  });
  return hasil;
}

/**
 * Bagian Target untuk tab Compare.
 * `hari` = hasil compare (hari 2026 beserta sesi dan pasangan 2025-nya).
 */
function hitungTarget(rows, event, hari) {
  const perSesi = gmvBrandPerSesi(rows);
  const daftarTarget = TARGET_2026.flatMap((k) =>
    k.brands.map(([brand, target]) => ({
      brand,
      kunci: kunciBrand(brand),
      kategori: k.kategori,
      target,
    })),
  );
  const kunciTarget = new Set(daftarTarget.map((b) => b.kunci));

  // Sesi terjadwal 2026 (tanpa "di luar sesi"), dengan GMV 2025 pasangannya
  const sesi = [];
  hari.forEach((h) => {
    const jadwal = event.sesi.filter((s) => s.hari === h.hari);
    h.sesi
      .filter((r) => r.sesi2026)
      .forEach((r) => {
        const s = jadwal.find((x) => x.mulai === r.mulai);
        sesi.push({ h, r, key: s ? s.key : null });
      });
  });
  const gmv25 = sesi.reduce((a, s) => a + s.r.v25.gmv, 0);

  // Aktual brand di luar daftar target (dari semua sesi & di luar sesi)
  const luar = new Map();
  perSesi.forEach((m) =>
    m.forEach((v, k) => {
      if (kunciTarget.has(k)) return;
      if (!luar.has(k)) luar.set(k, { brand: v.nama, gmv: 0 });
      luar.get(k).gmv += v.gmv;
    }),
  );

  const aktualBrandTotal = new Map();
  perSesi.forEach((m) =>
    m.forEach((v, k) =>
      aktualBrandTotal.set(k, (aktualBrandTotal.get(k) || 0) + v.gmv),
    ),
  );

  return {
    total: daftarTarget.reduce((a, b) => a + b.target, 0),
    kategori: TARGET_2026.map((k) => ({
      nama: k.kategori,
      target: k.brands.reduce((a, [, t]) => a + t, 0),
    })),
    brands: daftarTarget.map((b) => ({
      ...b,
      aktual: Math.round(aktualBrandTotal.get(b.kunci) || 0),
    })),
    jumlahSesi: sesi.length,
    sesi: sesi.map(({ h, r, key }) => {
      const m = (key && perSesi.get(key)) || new Map();
      const aktual = {};
      daftarTarget.forEach((b) => {
        const v = m.get(b.kunci);
        if (v) aktual[b.kunci] = Math.round(v.gmv);
      });
      return {
        hari: h.hari,
        nama: h.nama,
        jam: r.jam,
        sesi2026: r.sesi2026,
        status: r.status,
        gmv25: r.v25.gmv,
        // porsi sesi ini dari GMV Net 2025 seluruh sesi pasangan
        bobot: gmv25 ? r.v25.gmv / gmv25 : 1 / sesi.length,
        aktual,
      };
    }),
    luarTarget: [...luar.values()]
      .map((v) => ({ brand: v.brand, gmv: Math.round(v.gmv) }))
      .filter((v) => v.gmv > 0)
      .sort((a, b) => b.gmv - a.gmv),
  };
}

module.exports = { TARGET_2026, hitungTarget, gmvBrandPerSesi, kunciBrand };
