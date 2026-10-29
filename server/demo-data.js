"use strict";

/**
 * Data contoh untuk mode demo (database belum diisi). Bentuknya sama persis
 * dengan hasil query warehouse — termasuk angka sebagai teks "123000.0000"
 * seperti yang dikembalikan pg — supaya keduanya lewat satu jalur agregasi.
 * Pembangkitnya deterministik: angka yang tampil sama di setiap instance.
 */

const PRODUK = {
  HEYMALE: [
    ["HMKX1201", "BASIC TEE OVERSIZE", 149000],
    ["HMCH0710", "CHINO PANTS SLIM", 299000],
    ["HMJK0402", "COACH JACKET", 449000],
  ],
  HEYLOCAL: [
    ["LHXK1009", "AIRY SCARF", 99000],
    ["LHJZ7209", "SERA SCARF", 239000],
    ["LHOA8610", "BEYOND BATAVIA SCARF", 259000],
  ],
  BOONABOO: [
    ["BBAR2605", "SIERRA DIAPER BAG", 669000],
    ["BBAV0403", "SERENE KIDS", 299000],
    ["BBCT0202", "BONNIE TOTEBAG", 339000],
  ],
  HSC: [
    ["HSDR3301", "LINEN DRESS", 389000],
    ["HSBL2104", "RELAXED BLOUSE", 259000],
  ],
};
const BRANDS = Object.keys(PRODUK);
const BAYAR = [
  "QRIS EDC BCA",
  "QRIS EDC Mandiri",
  "Debit Card EDC BRI",
  "Cash",
  "QRIS FLIK",
];
const WARNA = ["BLACK", "NAVY", "CREAM", "OLIVE", null];
const UKURAN = ["S", "M", "L", "XL", "ALL SIZE"];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dua = (n) => String(n).padStart(2, "0");
const pgAngka = (n) => (n === null ? null : `${Math.round(n)}.0000`);

function tambahHari(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function demoRows(event) {
  const acak = mulberry32(20261030);
  const pilih = (arr) => arr[Math.floor(acak() * arr.length)];
  const rows = [];
  const jumlahHari =
    Math.round((Date.parse(event.sampai) - Date.parse(event.dari)) / 86400000) +
    1;
  const channels = event.warehouse.length ? event.warehouse : ["GUDANG EVENT"];
  let nomor = 0;

  for (let h = 1; h <= Math.min(jumlahHari, 7); h += 1) {
    const tanggal = tambahHari(event.dari, h - 1);
    const sesiHari = event.sesi.filter((s) => s.hari === h);
    const invoiceHari = 140 + Math.floor(acak() * 60);

    for (let n = 0; n < invoiceHari; n += 1) {
      // Sebagian besar transaksi jatuh di jam sesi; sisanya tersebar 10.00–21.00.
      let menit;
      if (sesiHari.length && acak() < 0.8) {
        const s = pilih(sesiHari);
        menit = s.mulai + Math.floor(acak() * (s.selesai - s.mulai));
      } else {
        menit = 600 + Math.floor(acak() * 660);
      }
      const waktu = `${dua(Math.floor(menit / 60))}:${dua(menit % 60)}:${dua(Math.floor(acak() * 60))}`;
      const channelIdx = acak() < 0.55 ? 0 : 1 % channels.length;
      const channel = channels[channelIdx];
      nomor += 1;
      const invoice = `IMP/${channelIdx === 0 ? "MS" : "TM"}/2026/${String(nomor).padStart(5, "0")}`;
      const status = acak() < 0.02 ? "Cancel" : "Delivery";
      const bayar = pilih(BAYAR);
      const promo = acak() < 0.15 ? ["IMPERFECT10", 25000] : [null, 0];

      const baris = [];
      const jumlahProduk = 1 + Math.floor(acak() * acak() * 4);
      for (let p = 0; p < jumlahProduk; p += 1) {
        const brand = pilih(BRANDS);
        const [sku, nama, harga] = pilih(PRODUK[brand]);
        // Tebus murah: harga dipotong dalam.
        const hargaJual =
          channelIdx === 1 ? Math.round((harga * 0.5) / 1000) * 1000 : harga;
        const qty = acak() < 0.85 ? 1 : 2;
        baris.push({
          brand,
          sku,
          nama,
          qty,
          total: hargaJual * qty,
          hpp: acak() < 0.1 ? null : harga * 0.42 * qty,
        });
      }
      const totalBayar = baris.reduce((s, b) => s + b.total, 0) - promo[1];

      baris.forEach((b) => {
        rows.push({
          tanggal,
          waktu,
          channel,
          invoice,
          payment_note: bayar,
          total_bayar: pgAngka(totalBayar),
          qty: pgAngka(b.qty),
          hpp: pgAngka(b.hpp),
          total_harga_barang: pgAngka(b.total),
          brand: b.brand,
          sku_produk: b.sku,
          nama_produk: b.nama,
          kategori: b.brand === "BOONABOO" ? "BAG" : "APPAREL",
          warna: pilih(WARNA),
          ukuran: pilih(UKURAN),
          promo_kode: promo[0],
          promo_value: pgAngka(promo[1]),
          status,
        });
      });
    }
  }
  return rows;
}

function createDemoSource(event) {
  return {
    name: "demo",
    async fetch() {
      return demoRows(event);
    },
    close: async () => {},
  };
}

module.exports = { createDemoSource, demoRows };
