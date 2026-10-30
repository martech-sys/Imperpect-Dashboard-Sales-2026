"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compare, perInvoice } = require("../server/compare");
const { parseSesi } = require("../server/sesi");
const { siapkan } = require("../server/store");
const { createApp } = require("../server/app");

const EVENT = { dari: "2026-10-30", sampai: "2026-11-01", sesi: parseSesi("") };

const baris = (o) => ({
  tanggal: "2026-10-30",
  waktu: "09:15:00",
  channel: "MAIN",
  qty: 1,
  total_bayar: 100000,
  total_harga_barang: 100000,
  status: "Paid",
  ...o,
});

const RAW = [
  baris({ invoice: "A", qty: 2, total_bayar: 500000 }),
  baris({ invoice: "A", qty: 1, total_bayar: 500000 }),
  baris({ invoice: "B", waktu: "12:59:00", total_bayar: 100000 }),
  baris({ invoice: "C", waktu: "13:30:00", total_bayar: 70000 }),
  baris({ invoice: "D", waktu: "08:00:00", total_bayar: 10000 }),
  baris({ invoice: "E", total_bayar: 999999, status: "Cancel" }),
];

// Jumat 30 Okt 2026, 13.40 WIB: Sesi 1 selesai, Sesi 2 (13.00) berjalan
const NOW = Date.parse("2026-10-30T06:40:00Z");

test("perInvoice: GMV = total bayar terbesar, unit dijumlah", () => {
  const { rows } = siapkan(RAW, EVENT);
  const a = perInvoice(rows).find((v) => v.unit === 3);
  assert.equal(a.gmv, 500000);
});

test("compare: Jumat 2026 dipasangkan dengan Jumat 2025, per jam sesi", () => {
  const { rows } = siapkan(RAW, EVENT);
  const r = compare(rows, EVENT, { now: NOW });

  assert.deepEqual(
    r.hari.map((h) => [h.nama, h.tanggal2025, h.status]),
    [
      ["Jumat", "2025-11-21", "berjalan"],
      ["Sabtu", "2025-11-22", "belum"],
      ["Minggu", "2025-11-23", "belum"],
    ],
  );
  assert.deepEqual(
    r.tanpaPasangan.map((t) => [t.nama, t.v25.gmv]),
    [["Kamis", 1788975600]],
  );
  // Kamis 2025 tetap punya rincian per sesi (kolom 2026 kosong)
  assert.deepEqual(
    r.tanpaPasangan[0].sesi.map((x) => [
      x.jam,
      x.sesi2025,
      x.status,
      x.v26.gmv,
    ]),
    [
      ["09.00-10.00", "Sesi 1", "tanpa-pasangan", 0],
      ["11.00-12.00", "Sesi 2", "tanpa-pasangan", 0],
      ["13.00-14.00", "Sesi 3", "tanpa-pasangan", 0],
      ["15.00-16.00", "Sesi 4", "tanpa-pasangan", 0],
      ["17.00-18.00", "Sesi 5", "tanpa-pasangan", 0],
      ["19.00-20.00", "Sesi 6", "tanpa-pasangan", 0],
    ],
  );
  assert.equal(r.tanpaPasangan[0].sesi[1].v25.gmv, 425544000);

  const jumat = r.hari[0].sesi;
  assert.deepEqual(
    jumat.map((s) => [s.jam, s.sesi2025, s.sesi2026, s.status]),
    [
      ["Di luar sesi", null, null, "selesai"],
      ["09.00-10.00", "Sesi 1", "Sesi 1", "selesai"],
      ["13.00-14.00", "Sesi 3", "Sesi 2", "berjalan"],
      ["15.00-16.00", "Sesi 4", "Sesi 3", "belum"],
      ["17.00-18.00", "Sesi 5", "Sesi 4", "belum"],
      ["19.00-20.00", "Sesi 6", "Sesi 5", "belum"],
    ],
  );
  // Sesi 1 2026 menampung 09.00–12.59: invoice A (500rb) + B (100rb)
  // GMV net = total bayar; gross = harga barang (2 × 100rb + 100rb)
  assert.deepEqual(jumat[1].v26, {
    unit: 4,
    trx: 2,
    gmv: 600000,
    gross: 300000,
  });
  assert.deepEqual(jumat[1].v25, { unit: 2768, trx: 245, gmv: 411451800 });
  assert.deepEqual(jumat[0].v26, {
    unit: 1,
    trx: 1,
    gmv: 10000,
    gross: 100000,
  });
  assert.equal(r.ringkas.v26.gross, 500000);

  // Pembanding "sampai kini" hanya memakai potongan yang sudah selesai
  assert.equal(r.sampaiKini.sesi, 1);
  assert.equal(r.sampaiKini.v26.gmv, 610000);
  assert.equal(r.sampaiKini.v25.gmv, 411451800 + 79000);
  assert.equal(r.ringkas.v26.gmv, 680000);
  assert.equal(r.ringkas.v25Semua.gmv, 7489875271);
  assert.equal(r.ringkas.v25Pasangan.gmv, 7489875271 - 1788975600);
  assert.ok(r.insight.length >= 3);
  assert.match(r.insight.join(" "), /sedang berjalan/);
});

test("compare: sebelum event belum ada sesi yang selesai", () => {
  const r = compare([], EVENT, { now: Date.parse("2026-10-29T03:00:00Z") });
  assert.equal(r.sampaiKini.sesi, 0);
  assert.ok(r.hari.every((h) => h.status === "belum"));
  assert.match(r.insight[0], /Belum ada sesi 2026 yang selesai/);
});

test("GET /api/compare (mode demo)", async () => {
  const app = createApp({ DEMO_MODE: "1" });
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(b) {
      this.body = b;
    },
  };
  await app.handle({ url: "/api/compare", method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.hari.length, 3);
  assert.ok(Array.isArray(body.insight));
  await app.close();
});
