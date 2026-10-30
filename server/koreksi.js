"use strict";

/**
 * Koreksi tanggal transaksi yang salah tercatat karena tanggal di perangkat
 * kasir keliru. Transaksi dalam daftar dipindah ke tanggal yang benar dengan
 * jam yang sama, sehingga masuk ke sesi hari itu dan tidak terhitung di hari
 * yang salah. Dicocokkan dengan no_order atau invoice_number (huruf
 * besar/kecil & spasi di tepi diabaikan).
 */
const KOREKSI_TANGGAL = [
  {
    // Kasir MAIN IMPERFECT WAREHOUS 2026 mencatat 31 Okt, padahal transaksi
    // terjadi 30 Okt 2026 (09.36–14.40).
    dari: "2026-10-31",
    ke: "2026-10-30",
    transaksi: [
      "JP/IMPWH/IMPRFCT24/DO-20261031144307",
      "JP/IMPWH/IMPRFCT24/DO-20261031143850",
      "JP/IMPWH/IMPRFCT24/DO-20261031143527",
      "JP/IMPWH/IMPRFCT24/DO-20261031142349",
      "JP/IMPWH/IMPRFCT24/DO-20261031141959",
      "JP/IMPWH/IMPRFCT24/DO-20261031141558",
      "JP/IMPWH/IMPRFCT24/20261031/135333",
      "JP/IMPWH/IMPRFCT24/20261031/134839",
      "JP/IMPWH/IMPRFCT24/20261031/112412",
      "JP/IMPWH/IMPRFCT24/20261031/103543",
      "JP/IMPWH/IMPRFCT24/20261031/102946",
      "JP/IMPWH/IMPRFCT24/20261031/102429",
      "JP/IMPWH/IMPRFCT24/20261031/101054",
      "JP/IMPWH/IMPRFCT24/20261031/093929",
      "JP/IMPWH/IMPRFCT24/20261031/093447",
      "INV-001268906",
      "INV-001268887",
      "INV-001268612",
      "INV-001268320",
      "INV-001268216",
      "INV-001268202",
    ],
  },
];

const norm = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();

/** → fungsi (baris mentah) → tanggal yang benar, atau null bila tidak dikoreksi. */
function createKoreksi(daftar = KOREKSI_TANGGAL) {
  const peta = new Map();
  daftar.forEach((k) =>
    k.transaksi.forEach((t) => peta.set(norm(t), { dari: k.dari, ke: k.ke })),
  );
  return function tanggalBenar(r) {
    for (const nilai of [r.no_order, r.invoice_number, r.invoice]) {
      const k = nilai ? peta.get(norm(nilai)) : null;
      // Hanya bila tanggal tercatat memang tanggal yang salah, supaya nomor
      // yang kebetulan sama di hari lain tidak ikut berpindah.
      if (k && String(r.tanggal || "").slice(0, 10) === k.dari) return k.ke;
    }
    return null;
  };
}

module.exports = { KOREKSI_TANGGAL, createKoreksi };
