"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSesi } = require("../server/sesi");
const { siapkan } = require("../server/store");
const report = require("../server/report");

const event = {
  dari: "2026-10-30",
  sampai: "2026-11-01",
  warehouse: ["MAIN", "TEBUS"],
  kolomChannel: "warehouse",
  sesi: parseSesi("Day 1: 09.00-10.00, 13.00-14.00\nDay 2: 09.00-10.00"),
};

const baris = (o) => ({
  tanggal: "2026-10-30",
  waktu: "09:10:00",
  channel: "MAIN",
  invoice: "A",
  total_bayar: "0.0000",
  qty: "1.0000",
  hpp: null,
  total_harga_barang: "100000.0000",
  brand: "X",
  status: "Delivery",
  ...o,
});

const RAW = [
  // invoice A: dua brand, dua gudang — satu TRX di TOTAL
  baris({
    invoice: "A",
    total_bayar: "350000.0000",
    payment_note: "QRIS",
    brand: "X",
    total_harga_barang: "100000.0000",
    hpp: "40000.0000",
  }),
  baris({
    invoice: "A",
    total_bayar: "350000.0000",
    payment_note: "QRIS",
    brand: "Y",
    channel: "TEBUS",
    qty: "2.0000",
    total_harga_barang: "250000.0000",
  }),
  baris({
    invoice: "B",
    waktu: "13:30:00",
    payment_note: "Cash",
    brand: "Y",
    total_harga_barang: "50000.0000",
  }),
  baris({
    invoice: "C",
    waktu: "11:00:00",
    brand: "X",
    total_harga_barang: "70000.0000",
  }),
  baris({
    invoice: "D",
    tanggal: "2026-10-31",
    waktu: "09:05:00",
    total_harga_barang: "80000.0000",
  }),
  baris({ invoice: "E", status: "Cancel", total_harga_barang: "999000.0000" }),
];
const { rows, dibuang } = siapkan(RAW, event);

test("status Cancel dibuang, angka teks dari pg dibaca sebagai angka", () => {
  assert.equal(dibuang, 1);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].total_harga_barang, 100000);
  assert.equal(rows[0].total_bayar, 350000);
});

test("pivot sesi: sesi terjadwal tampil walau kosong, di luar sesi hanya bila ada isinya", () => {
  const p = report.pivot(rows, event, {});
  assert.deepEqual(
    p.rows.map((r) => r.label),
    [
      "Day 1 | Sesi 1 (09.00-10.00)",
      "Day 1 | Sesi 2 (13.00-14.00)",
      "Day 1 | Di luar sesi",
      "Day 2 | Sesi 1 (09.00-10.00)",
    ],
  );
  const s1 = p.rows[0];
  assert.deepEqual(s1.cells.MAIN, { qty: 1, trx: 1, gmv: 100000 });
  assert.deepEqual(s1.cells.TEBUS, { qty: 2, trx: 1, gmv: 250000 });
  // invoice A tercatat di dua gudang, tetapi satu transaksi di TOTAL
  assert.deepEqual(s1.total, { qty: 3, trx: 1, gmv: 350000 });
  assert.deepEqual(p.total, { qty: 6, trx: 4, gmv: 550000 });
  assert.equal(p.summary.aov, 137500);
});

test("kolom channel diurutkan sesuai pilihan dan gudang kosong tetap tampil", () => {
  const p = report.pivot(rows, event, { urut: "gmv", brand: "Y" });
  assert.deepEqual(
    p.columns.map((c) => c.key),
    ["TEBUS", "MAIN"],
  );
  assert.equal(p.columns[1].gmv, 50000);
  const kosong = report.pivot(
    rows,
    { ...event, warehouse: ["MAIN", "TEBUS", "BARU"] },
    { urut: "nama" },
  );
  assert.deepEqual(
    kosong.columns.map((c) => c.key),
    ["BARU", "MAIN", "TEBUS"],
  );
  assert.equal(kosong.columns[0].trx, 0);
});

test("pivot per hari, brand, dan jam; filter hari", () => {
  const perHari = report.pivot(rows, event, { baris: "hari" });
  assert.deepEqual(
    perHari.rows.map((r) => r.label),
    ["Day 1 · 30 Okt", "Day 2 · 31 Okt", "Day 3 · 1 Nov"],
  );
  assert.equal(perHari.rows[2].total.trx, 0);

  const perBrand = report.pivot(rows, event, { baris: "brand" });
  assert.deepEqual(
    perBrand.rows.map((r) => [r.label, r.total.gmv]),
    [
      ["Y", 300000],
      ["X", 250000],
    ],
  );

  const perJam = report.pivot(rows, event, { baris: "jam", hari: "1" });
  assert.deepEqual(
    perJam.rows.map((r) => r.label),
    ["09.00-10.00", "11.00-12.00", "13.00-14.00"],
  );
  assert.equal(perJam.total.trx, 3);
});

test("rincian: urutan kolom, total bayar hanya di baris pertama invoice", () => {
  const r = report.transactions(rows, { sesi: "1-1" });
  assert.equal(r.total, 2);
  assert.deepEqual(Object.keys(r.rows[0]), [
    "brand",
    "tanggal",
    "waktu",
    "invoice",
    "sku_produk",
    "nama_produk",
    "kategori",
    "channel",
    "qty",
    "total_harga_barang",
    "promo_value",
    "total_bayar",
    "payment_note",
    "status",
  ]);
  assert.deepEqual(
    r.rows.map((x) => x.total_bayar),
    [350000, null],
  );
  assert.equal(r.summary.trx, 1);
});

test("rincian: total bayar tidak tertulis ulang saat invoice terpotong halaman", () => {
  const hal2 = report.transactions(rows, {
    sesi: "1-1",
    pageSize: "1",
    page: "2",
  });
  assert.equal(hal2.rows.length, 1);
  assert.equal(hal2.rows[0].total_bayar, null);
});

test("rincian: pencarian dan urutan", () => {
  assert.equal(report.transactions(rows, { q: "d" }).total, 1);
  const asc = report.transactions(rows, { sortBy: "tanggal", sortDir: "asc" });
  assert.deepEqual(
    asc.rows.map((r) => r.invoice),
    ["A", "A", "C", "B", "D"],
  );
});

test("rincian: filter metode bayar, termasuk yang kosong", () => {
  assert.deepEqual(report.opsiFilter(rows, event).payments, [
    "(tanpa metode bayar)",
    "Cash",
    "QRIS",
  ]);
  const qris = report.transactions(rows, { payment: "QRIS" });
  assert.deepEqual(
    qris.rows.map((r) => r.invoice),
    ["A", "A"],
  );
  assert.equal(report.transactions(rows, { payment: "Cash" }).total, 1);
  assert.equal(
    report.transactions(rows, { payment: "(tanpa metode bayar)" }).total,
    2,
  );
  // Pivot tidak disaring metode bayar.
  assert.equal(report.pivot(rows, event, { payment: "Cash" }).total.trx, 4);
});

test("CSV memakai urutan kolom tabel, pemisah titik koma, dan BOM", () => {
  const csv = report.transactionsCsv(rows, {});
  assert.ok(
    csv.startsWith(
      "\ufeffbrand;tanggal;waktu;invoice;sku_produk;nama_produk;kategori;channel;qty;harga;promo_value;total_bayar;payment_method;status\n",
    ),
  );
  assert.ok(!csv.includes("hpp"));
  assert.equal(csv.split("\n").length, 6);
});

test("EVENT_DATA_DARI lebih awal: tanggal sebelum Day 1 jadi Day 0, sesi event tidak bergeser", () => {
  const ev = { ...event, dataDari: "2026-10-29" };
  const raw = [
    baris({
      invoice: "U1",
      tanggal: "2026-10-29",
      waktu: "09:30:00",
      total_harga_barang: "50000.0000",
    }),
    baris({ invoice: "A", tanggal: "2026-10-30", waktu: "09:30:00" }),
  ];
  const { rows: r } = siapkan(raw, ev);
  assert.equal(r[0].hari, 0);
  assert.equal(r[0].sesi, "0-0");
  assert.equal(r[1].sesi, "1-1");

  const p = report.pivot(r, ev, {});
  assert.equal(p.rows[0].label, "Day 0 | Di luar sesi");
  assert.equal(p.rows[0].total.gmv, 50000);
  assert.equal(p.rows[1].label, "Day 1 | Sesi 1 (09.00-10.00)");

  const perHari = report.pivot(r, ev, { baris: "hari" });
  assert.equal(perHari.rows[0].label, "Day 0 · 29 Okt");
  assert.equal(report.opsiFilter(r, ev).hari[0].label, "Day 0 · 29 Okt");
  assert.equal(report.pivot(r, ev, { hari: "0" }).total.trx, 1);
});
