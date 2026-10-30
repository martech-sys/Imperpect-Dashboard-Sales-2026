"use strict";

/**
 * Transaksi yang BELUM masuk database (laporan_penjualan), disisipkan manual
 * dari ekspor kasir "daftar_penjualan_barang" (MAIN IMPERFECT WAREHOUS 2026).
 *
 * - Ditambahkan ke hasil query hanya bila order itu belum ada di database
 *   (dicocokkan lewat no_order / invoice_number). Begitu database sudah
 *   memuatnya, data database yang dipakai dan baris di sini otomatis
 *   diabaikan — tidak pernah terhitung dua kali.
 * - Tanggal ditulis apa adanya dari kasir (31 Okt); server/koreksi.js
 *   memindahkannya ke 30 Okt dengan jam yang sama, sama seperti data database.
 * - Brand dari huruf depan SKU (lihat brandDariSku). Total bayar per order
 *   dari layar kasir; selisih dengan jumlah harga barang = promo.
 * - Nama & nomor telepon pelanggan sengaja tidak disalin.
 */

const TANGGAL_KASIR = "2026-10-31";
const GUDANG = "MAIN IMPERFECT WAREHOUS 2026";

/** no_order → { invoice_number, total_bayar } (dari layar kasir) */
const ORDER = {
  "JP/IMPWH/IMPRFCT24/20261031/093447": ["INV-001268202", 199000],
  "JP/IMPWH/IMPRFCT24/20261031/093929": ["INV-001268216", 10000],
  "JP/IMPWH/IMPRFCT24/20261031/101054": ["INV-001268320", 516000],
  "JP/IMPWH/IMPRFCT24/20261031/102429": [null, 556000],
  "JP/IMPWH/IMPRFCT24/20261031/102946": [null, 418000],
  "JP/IMPWH/IMPRFCT24/20261031/103543": [null, 9845000],
  "JP/IMPWH/IMPRFCT24/20261031/112412": ["INV-001268612", 1975000],
  "JP/IMPWH/IMPRFCT24/20261031/134839": ["INV-001268887", 1086000],
  "JP/IMPWH/IMPRFCT24/20261031/135333": ["INV-001268906", 567000],
};

/** [no_order, jam, sku, nama barang, qty, jumlah harga] */
const BARIS = [
  [
    "JP/IMPWH/IMPRFCT24/20261031/093447",
    "09:36:42",
    "MIBE0000",
    "MENSWEAR BEST DEALS JACKETS",
    1,
    199000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/102429",
    "10:28:03",
    "LHGV7409",
    "LHGV74-SCOTTISH SCARF SKY",
    1,
    149000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/102429",
    "10:28:03",
    "BABC1100",
    "BABC11-SIMPLY NURSING APRON TENCEL FULL COVER BEIGE",
    1,
    139000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/102429",
    "10:28:03",
    "BBBF2303",
    "BBBF23-BUNNY LUNCH BAG TAUPE",
    1,
    139000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/102429",
    "10:28:03",
    "LOBW3201",
    "LOBW32-BRIA WALLET BRONZE",
    1,
    129000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/101054",
    "10:20:53",
    "MLRP5603",
    "MLRP56-Stravine Knit Polo Olive",
    1,
    129000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/101054",
    "10:20:53",
    "MLRP0501",
    "MLRP05-Stravine Knit Polo Brown",
    1,
    129000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/101054",
    "10:20:53",
    "MLRP0505",
    "MLRP05-Stravine Knit Polo Brown",
    1,
    129000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/101054",
    "10:20:53",
    "MIBF0000",
    "MENSWEAR BEST DEALS KNITWEAR",
    1,
    129000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "WFWAAB0104",
    "SHOPPING BAG IMPERFECT",
    1,
    12000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LBTB0702",
    "LBTB07-TOKYO TOTEBAG ESPRESSOO",
    1,
    299000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LBTB0301",
    "LBTB03-TOKYO TOTEBAG BLACK",
    2,
    478000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "SBCT2111",
    "SBCT21-AYUMI TOTE BAG TAUPE",
    2,
    1138000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LBQB3301",
    "LBQB33-ORLA TOTEBAG 2.0 BLUSH",
    1,
    239000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LOBZ6100",
    "LOBZ61-TRULY YOURS",
    7,
    903000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LOGA1221",
    "LOGA12-VERVE EDP",
    2,
    258000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LAYK8605",
    "LAYK86-LADY FIT STRIVE TOP BLUSH",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LAYM8604",
    "LAYM86-LADY FIT STRIVE LEGGING SKIRT BLUSH",
    3,
    537000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LAJG6400",
    "LAJG64-NSPIRE SPORT VEST JACKET CHARCOAL",
    1,
    129000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LHYL8604",
    "LHYL86-LADY FIT STRIVE HIJAB VEST BLUSH",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LAIG8605",
    "LAIG86-FLEXY SPORT SKIRT LEGGING BLUSH",
    1,
    129000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LAYM0304",
    "LAYM03-LADY FIT STRIVE LEGGING SKIRT ONYX",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LAYM5404",
    "LAYM54-LADY FIT STRIVE LEGGING SKIRT MOSS",
    3,
    537000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LAIJ0300",
    "LAIJ03-FLEXY SPORT VEST HIJAB BLACK",
    1,
    129000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LABC0304",
    "LABC03-LADY FIT RUNERA SKIRT ONYX",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LIBH0000",
    "HEYLOCAL BEST DEALS TOP",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LBGH0302",
    "LBGH03-FERMO CANVAS BAG BLACK",
    2,
    598000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LBUG3802",
    "LBUG38-OLENA SHOULDER BAG DENIM",
    1,
    299000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LBGH2602",
    "LBGH26-FERMO CANVAS BAG TAUPE",
    2,
    598000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "SAAQ7705",
    "SAAQ77-YUMNA PLEATED SKIRT JET BLACK",
    1,
    189000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "SAAQ4904",
    "SAAQ49-YUMNA PLEATED SKIRT PLUM",
    1,
    189000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LBHC0702",
    "LBHC07-HLC TOTEBAG WAFFLE",
    1,
    299000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LABC4304",
    "LABC43-LADY FIT RUNERA SKIRT CLOUD",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LHYL8605",
    "LHYL86-LADY FIT STRIVE HIJAB VEST BLUSH",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "SAFQ8308",
    "SAFQ83-HAVVA ABAYA LAVENDER",
    1,
    579000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LBQB1801",
    "LBQB18-ORLA TOTEBAG 2.0 DENIM",
    1,
    239000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LBCG0801",
    "LBCG08-PUSPHA BAG GADING",
    1,
    239000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LABU0404",
    "LABU04-ROMPI MANGGALA KABUT",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LHGA7300",
    "LHGA73-MINETTE PRAYER SET MUSTARD",
    2,
    538000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/103543",
    "10:55:08",
    "LAYN7205",
    "LAYN72-LADY FIT STRIVE RAGLAN JACKET IVORY",
    2,
    358000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/134839",
    "13:50:48",
    "WFWAAB0102",
    "SHOPPING BAG IMPERFECT",
    1,
    10000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/134839",
    "13:50:48",
    "LADQ2505",
    "LADQ25-GAUN LIPIT TENTREM SARI",
    1,
    299000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/134839",
    "13:50:48",
    "LACU6504",
    "LACU65-KEMEJA BROKAT RENJANA EMBUN",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/134839",
    "13:50:48",
    "LADW0405",
    "LADW04-GAUN MIDI BERMOTIF TENTREM KELABU",
    1,
    299000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/134839",
    "13:50:48",
    "LBUG0302",
    "LBUG03-OLENA SHOULDER BAG BLACK",
    1,
    299000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/135333",
    "13:55:50",
    "WFWAAB0102",
    "SHOPPING BAG IMPERFECT",
    1,
    10000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/135333",
    "13:55:50",
    "MONO0504",
    "MONO05-Luxuede Jacket Brown",
    1,
    199000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/135333",
    "13:55:50",
    "PPES0233",
    "PPES02-STREAKY TROUSERS BLACK",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/135333",
    "13:55:50",
    "MIBG0000",
    "MENSWEAR BEST DEALS PANTS",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/093929",
    "09:40:26",
    "WFWAAB0102",
    "SHOPPING BAG IMPERFECT",
    1,
    10000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHXK4609",
    "LHXK46-AIRY SCARF CLAY",
    1,
    69000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHXK9709",
    "LHXK97-AIRY SCARF SAND",
    1,
    69000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHCZ0503",
    "LHCZ05-COZY SCARF SILVER",
    1,
    69000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHGV1209",
    "LHGV12-SCOTTISH SCARF PALECREST",
    1,
    149000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHSS7209",
    "LHSS72-COASTAL APPEAL SCARF KYLE",
    3,
    447000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHSS3709",
    "LHSS37-COASTAL APPEAL SCARF MEERA",
    1,
    149000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHIU0809",
    "LHIU08-SOUNDS OF GARDEN SCARF CLOVER",
    1,
    149000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LACY5605",
    "LACY56-ROMPI BROKAT RENJANA TENUN",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHPW1616",
    "LHPW16-SERASI PRAYER SET KIDS EMERALD",
    1,
    179000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHCZ8003",
    "LHCZ80-COZY SCARF DESSERT",
    1,
    69000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHBO0409",
    "LHBO04-PALETTIA SCARF LAGOON",
    2,
    298000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/112412",
    "11:29:37",
    "LHCD3109",
    "LHCD31-TENTREM SCARF RIMBA",
    1,
    149000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/102946",
    "10:33:16",
    "WFWAAB0102",
    "SHOPPING BAG IMPERFECT",
    1,
    10000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/102946",
    "10:33:16",
    "SAGV0000",
    "HUGGABLE SHUWA",
    1,
    89000,
  ],
  [
    "JP/IMPWH/IMPRFCT24/20261031/102946",
    "10:33:16",
    "SAES4605",
    "SAES46-AIKO BARAYA CLAY",
    1,
    319000,
  ],
];

const BRAND_HURUF = {
  B: "BOONABOO",
  L: "HEYLOCAL",
  M: "HEYMALE",
  N: "NOSTALGY",
  P: "PREPPSTUDIO",
  S: "SHUWA MODEST",
  W: "THE WAREHOUSE PROJECT",
  Z: "ZOMA BASIC",
};

/**
 * Brand dari huruf depan SKU. Seluruh huruf L (termasuk barang LADY FIT)
 * digabung ke HEYLOCAL.
 */
function brandDariSku(sku) {
  return (
    BRAND_HURUF[
      String(sku || "")
        .charAt(0)
        .toUpperCase()
    ] || null
  );
}

/** Baris berformat sama dengan hasil query server/source-postgres.js. */
function barisManual() {
  const promoSudah = new Set();
  return BARIS.map(([noOrder, waktu, sku, nama, qty, harga]) => {
    const [invoiceNumber, totalBayar] = ORDER[noOrder];
    const jumlahHarga = BARIS.filter((b) => b[0] === noOrder).reduce(
      (a, b) => a + b[5],
      0,
    );
    const promo = Math.max(0, jumlahHarga - totalBayar);
    const pertama = !promoSudah.has(noOrder);
    promoSudah.add(noOrder);
    return {
      tanggal: TANGGAL_KASIR,
      waktu,
      channel: GUDANG,
      invoice: invoiceNumber || noOrder,
      no_order: noOrder,
      invoice_number: invoiceNumber,
      payment_note: null,
      total_bayar: totalBayar,
      qty,
      total_harga_barang: harga,
      brand: brandDariSku(sku),
      sku_produk: sku,
      nama_produk: nama,
      kategori: null,
      warna: null,
      ukuran: null,
      promo_kode: null,
      promo_value: pertama ? promo : 0,
      status: "COMPLETED",
    };
  });
}

const norm = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();

/**
 * Hasil query + baris manual yang order-nya belum ada di database dan masuk
 * gudang & rentang tanggal event.
 */
function tambahManual(rows, event) {
  const ada = new Set();
  rows.forEach((r) =>
    [r.no_order, r.invoice_number, r.invoice].forEach(
      (v) => v && ada.add(norm(v)),
    ),
  );
  const dari = event.dataDari || event.dari;
  const tambahan = barisManual().filter(
    (r) =>
      event.warehouse.includes(r.channel) &&
      r.tanggal >= dari &&
      r.tanggal <= event.sampai &&
      !ada.has(norm(r.no_order)) &&
      !(r.invoice_number && ada.has(norm(r.invoice_number))),
  );
  return tambahan.length ? [...rows, ...tambahan] : rows;
}

module.exports = { barisManual, brandDariSku, tambahManual };
