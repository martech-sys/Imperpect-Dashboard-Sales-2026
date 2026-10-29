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
    brand: "X",
    total_harga_barang: "100000.0000",
    hpp: "40000.0000",
  }),
  baris({
    invoice: "A",
    total_bayar: "350000.0000",
    brand: "Y",
    channel: "TEBUS",
    qty: "2.0000",
    total_harga_barang: "250000.0000",
  }),
  baris({
    invoice: "B",
    waktu: "13:30:00",
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
  assert.equal(rows[2].hpp, null);
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

test("rincian: total bayar hanya di baris pertama invoice, HPP hanya bila diizinkan", () => {
  const tanpa = report.transactions(
    rows,
    event,
    { sesi: "1-1" },
    { hpp: false },
  );
  assert.equal(tanpa.total, 2);
  assert.deepEqual(
    tanpa.rows.map((r) => r.total_bayar),
    [350000, null],
  );
  assert.ok(!("hpp" in tanpa.rows[0]));
  assert.equal(tanpa.summary.trx, 1);

  const dengan = report.transactions(
    rows,
    event,
    { sesi: "1-1" },
    { hpp: true },
  );
  assert.equal(dengan.rows[0].hpp, 40000);
  assert.equal(dengan.rows[0].sesi_label, "Day 1 | Sesi 1 (09.00-10.00)");
});

test("rincian: total bayar tidak tertulis ulang saat invoice terpotong halaman", () => {
  const hal2 = report.transactions(
    rows,
    event,
    { sesi: "1-1", pageSize: "1", page: "2" },
    { hpp: false },
  );
  assert.equal(hal2.rows.length, 1);
  assert.equal(hal2.rows[0].total_bayar, null);
});

test("rincian: pencarian dan urutan", () => {
  assert.equal(report.transactions(rows, event, { q: "d" }, {}).total, 1);
  const asc = report.transactions(
    rows,
    event,
    { sortBy: "tanggal", sortDir: "asc" },
    {},
  );
  assert.deepEqual(
    asc.rows.map((r) => r.invoice),
    ["A", "A", "C", "B", "D"],
  );
});

test("CSV memakai pemisah titik koma, BOM, dan tanpa HPP bila tidak diizinkan", () => {
  const csv = report.transactionsCsv(rows, event, {}, { hpp: false });
  assert.ok(csv.startsWith("﻿tanggal;waktu;sesi_label;"));
  assert.ok(!csv.includes(";hpp;"));
  assert.equal(csv.split("\n").length, 6);
});
