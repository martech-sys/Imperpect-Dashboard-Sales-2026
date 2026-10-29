"use strict";

const eksternal = require("./eksternal");

/**
 * Ringkasan All: penjualan internal (warehouse, `laporan_penjualan`) dan
 * eksternal (Sheet per brand) dalam satu tampilan.
 *
 * Kedua sumber tidak punya kunci bersama, jadi digabung per angka saja:
 * - Unit sold dan GMV dijumlahkan langsung.
 * - TRX internal = invoice berbeda; TRX eksternal = baris Sheet bernilai.
 *   TRX gabungan = jumlah keduanya (satu transaksi tidak mungkin tercatat di
 *   dua sumber — README papan TV melarang mencatat transaksi yang sama di
 *   warehouse dan Sheet brand).
 * - Per brand: nama brand dicocokkan tanpa membedakan huruf besar/kecil dan
 *   spasi, supaya brand yang punya penjualan di kedua sumber jadi satu baris.
 *
 * Satu sumber yang gagal tidak mengosongkan tab ini: sumber yang terbaca
 * tetap tampil, yang gagal disebut di `galat`.
 */

const kunciBrand = (nama) =>
  String(nama || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

function ringkasInternal(rows) {
  const total = { qty: 0, gmv: 0, inv: new Set() };
  const perChannel = new Map();
  const perBrand = new Map();
  const tambah = (peta, k, r) => {
    if (!peta.has(k)) peta.set(k, { qty: 0, gmv: 0, inv: new Set() });
    const g = peta.get(k);
    g.qty += r.qty;
    g.gmv += r.total_harga_barang || 0;
    if (r.invoice) g.inv.add(r.invoice);
  };
  for (const r of rows) {
    total.qty += r.qty;
    total.gmv += r.total_harga_barang || 0;
    if (r.invoice) total.inv.add(r.invoice);
    tambah(perChannel, r.channel, r);
    tambah(perBrand, r.brand, r);
  }
  const rapi = (g) => ({ qty: g.qty, trx: g.inv.size, gmv: Math.round(g.gmv) });
  return {
    summary: rapi(total),
    channels: [...perChannel.entries()]
      .map(([nama, g]) => ({ nama, ...rapi(g) }))
      .sort((a, b) => b.gmv - a.gmv),
    brands: [...perBrand.entries()].map(([nama, g]) => ({ nama, ...rapi(g) })),
  };
}

function ringkasanAll({ internalRows, eksternalFiles }) {
  const internal = internalRows ? ringkasInternal(internalRows) : null;
  const eks = eksternalFiles ? eksternal.ringkasan(eksternalFiles) : null;

  const brands = new Map();
  const ambil = (nama) => {
    const k = kunciBrand(nama);
    if (!brands.has(k)) {
      brands.set(k, {
        brand: nama,
        internal: { qty: 0, trx: 0, gmv: 0 },
        eksternal: { qty: 0, trx: 0, gmv: 0 },
      });
    }
    return brands.get(k);
  };
  (internal ? internal.brands : []).forEach((b) => {
    ambil(b.nama).internal = { qty: b.qty, trx: b.trx, gmv: b.gmv };
  });
  (eks ? eks.brands : []).forEach((b) => {
    // Sheet tanpa transaksi bukan brand yang berjualan; cukup tampil di tab Eksternal.
    if (!b.trx) return;
    ambil(b.brand).eksternal = { qty: b.qty, trx: b.trx, gmv: b.gmv };
  });

  const nol = { qty: 0, trx: 0, gmv: 0 };
  const sI = internal ? internal.summary : nol;
  const sE = eks
    ? { qty: eks.summary.qty, trx: eks.summary.trx, gmv: eks.summary.gmv }
    : nol;
  const total = {
    qty: sI.qty + sE.qty,
    trx: sI.trx + sE.trx,
    gmv: sI.gmv + sE.gmv,
  };
  const persen = (v) => (total.gmv ? (v / total.gmv) * 100 : 0);

  const daftar = [...brands.values()]
    .map((b) => {
      const gmv = b.internal.gmv + b.eksternal.gmv;
      const ada = [
        b.internal.trx > 0 && "internal",
        b.eksternal.trx > 0 && "eksternal",
      ].filter(Boolean);
      return {
        brand: b.brand,
        sumber: ada.length === 2 ? "keduanya" : ada[0] || "internal",
        qty: b.internal.qty + b.eksternal.qty,
        trx: b.internal.trx + b.eksternal.trx,
        gmv,
        gmvInternal: b.internal.gmv,
        gmvEksternal: b.eksternal.gmv,
        kontribusi: persen(gmv),
      };
    })
    .sort((a, b) => b.gmv - a.gmv || a.brand.localeCompare(b.brand, "id"));

  return {
    total: {
      ...total,
      aov: total.trx ? Math.round(total.gmv / total.trx) : 0,
      brand: daftar.length,
    },
    internal: internal
      ? {
          ...sI,
          kontribusi: persen(sI.gmv),
          brand: internal.brands.length,
          channels: internal.channels.map((c) => ({
            ...c,
            kontribusi: persen(c.gmv),
          })),
        }
      : null,
    eksternal: eks
      ? {
          ...sE,
          kontribusi: persen(sE.gmv),
          brand: eks.summary.brandAktif,
          brandSheet: eks.summary.brand,
          brandGagal: eks.summary.brandGagal,
        }
      : null,
    brands: daftar,
  };
}

module.exports = { ringkasanAll, kunciBrand };
