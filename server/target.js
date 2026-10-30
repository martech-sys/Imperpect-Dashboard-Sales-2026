"use strict";

/**
 * Target penjualan Imperfect Sale 2026 per brand (GMV), dibagi ke tiap sesi
 * event dengan dua cara:
 *   - rata         : target ÷ jumlah sesi 2026
 *   - proporsional : target × porsi GMV Net sesi pasangannya di 2025
 *                    (hari & jam yang sama), sehingga sesi yang tahun lalu
 *                    ramai mendapat target lebih besar.
 *
 * Aktual per brand = GMV Net (total bayar) invoice dibagi ke brand-brand di
 * dalamnya menurut porsi total_harga_barang — total bayar hanya tercatat per
 * invoice, bukan per brand. Nama brand dicocokkan tanpa memedulikan huruf
 * besar/kecil, spasi, dan tanda baca (principal_brand).
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
 * GMV Net per brand tiap invoice: total bayar invoice (MAX, berulang di tiap
 * baris) dibagi menurut porsi harga barang; bila harga kosong menurut qty,
 * lalu rata. Invoice ikut sesi baris pertamanya, sama dengan compare.js.
 * → Map kunci sesi → Map kunci brand → { nama, gmv }
 */
function gmvBrandPerSesi(rows) {
  const inv = new Map();
  rows.forEach((r, i) => {
    if (r.hari === null || r.hari === undefined) return;
    const kunci = r.invoice || `tanpa-invoice-${i}`;
    let v = inv.get(kunci);
    if (!v) {
      v = { hari: r.hari, sesi: r.sesi, menit: r.menit, bayar: 0, baris: [] };
      inv.set(kunci, v);
    }
    const lebihAwal =
      r.hari < v.hari ||
      (r.hari === v.hari && (r.menit ?? Infinity) < (v.menit ?? Infinity));
    if (lebihAwal)
      Object.assign(v, { hari: r.hari, sesi: r.sesi, menit: r.menit });
    v.bayar = Math.max(v.bayar, r.total_bayar || 0);
    v.baris.push(r);
  });

  const hasil = new Map();
  inv.forEach((v) => {
    const bobotDari = [(r) => r.total_harga_barang, (r) => r.qty, () => 1];
    for (const bobot of bobotDari) {
      const jumlah = v.baris.reduce(
        (s, r) => s + Math.max(0, bobot(r) || 0),
        0,
      );
      if (jumlah <= 0) continue;
      if (!hasil.has(v.sesi)) hasil.set(v.sesi, new Map());
      const perBrand = hasil.get(v.sesi);
      v.baris.forEach((r) => {
        const k = kunciBrand(r.brand);
        if (!perBrand.has(k)) perBrand.set(k, { nama: r.brand, gmv: 0 });
        perBrand.get(k).gmv += (v.bayar * Math.max(0, bobot(r) || 0)) / jumlah;
      });
      return;
    }
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
