"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSesi, createPenentuSesi, menitDari } = require("../server/sesi");

test("jadwal bawaan sama dengan tabel event: 5 sesi Day 1, 3 sesi Day 2", () => {
  const sesi = parseSesi("");
  assert.equal(sesi.filter((s) => s.hari === 1).length, 5);
  assert.equal(sesi.filter((s) => s.hari === 2).length, 3);
  assert.equal(sesi[0].label, "Day 1 | Sesi 1 (09.00-10.00)");
  assert.equal(sesi[6].label, "Day 2 | Sesi 2 (11.00-12.00)");
});

test("nomor sesi mengikuti urutan jam, apa pun urutan tulisannya", () => {
  const sesi = parseSesi(
    "Day 3: 15:00-16:00, 09.00-10.00; hari 1: 10.00-11.30",
  );
  assert.deepEqual(
    sesi.map((s) => s.label),
    [
      "Day 1 | Sesi 1 (10.00-11.30)",
      "Day 3 | Sesi 1 (09.00-10.00)",
      "Day 3 | Sesi 2 (15.00-16.00)",
    ],
  );
});

test("salah tulis dan rentang bertumpuk ditolak dengan pesan yang jelas", () => {
  assert.throws(() => parseSesi("Day 1 09.00-10.00"), /tidak terbaca/);
  assert.throws(() => parseSesi("Day 1: 9-10"), /rentang "9-10"/);
  assert.throws(
    () => parseSesi("Day 1: 10.00-09.00"),
    /berakhir sebelum mulai/,
  );
  assert.throws(
    () => parseSesi("Day 1: 09.00-10.00, 09.30-11.00"),
    /bertumpuk/,
  );
});

test("transaksi masuk sesi: mulai termasuk, selesai tidak; sisanya di luar sesi", () => {
  const tentukan = createPenentuSesi(
    parseSesi("Day 1: 09.00-10.00"),
    "2026-10-30",
  );
  assert.equal(tentukan("2026-10-30", "09:00:00").sesi, "1-1");
  assert.equal(tentukan("2026-10-30", "09:59:59").sesi, "1-1");
  assert.equal(tentukan("2026-10-30", "10:00:00").sesi, "1-0");
  assert.equal(tentukan("2026-10-31", "09:30:00").sesi, "2-0");
  assert.equal(tentukan("2026-10-31", "09:30:00").hari, 2);
  assert.equal(tentukan("2026-10-30", null).sesi, "1-0");
});

test("jam dibaca dari time maupun timestamp", () => {
  assert.equal(menitDari("09:15:00"), 555);
  assert.equal(menitDari("2026-10-30 13:05:00+07"), 785);
  assert.equal(menitDari("25:00"), null);
  assert.equal(menitDari(""), null);
});
