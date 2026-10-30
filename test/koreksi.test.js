"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createKoreksi } = require("../server/koreksi");
const { siapkan } = require("../server/store");
const { parseSesi } = require("../server/sesi");

const EVENT = { dari: "2026-10-30", sampai: "2026-11-01", sesi: parseSesi("") };

const baris = (o) => ({
  tanggal: "2026-10-31",
  waktu: "09:36:00",
  channel: "MAIN IMPERFECT WAREHOUS 2026",
  qty: 1,
  total_bayar: 199000,
  total_harga_barang: 199000,
  status: "COMPLETED",
  ...o,
});

test("koreksi: transaksi salah tanggal pindah ke hari yang benar, jam tetap", () => {
  const raw = [
    // dicocokkan lewat invoice_number
    baris({
      invoice: "INV-001268202",
      invoice_number: "INV-001268202",
      no_order: "JP/IMPWH/IMPRFCT24/20261031/093447",
    }),
    // tanpa invoice_number: lewat no_order (huruf kecil & spasi diabaikan)
    baris({
      invoice: " jp/impwh/imprfct24/20261031/103543 ",
      no_order: " jp/impwh/imprfct24/20261031/103543 ",
      waktu: "10:55:00",
    }),
    // transaksi asli 31 Okt tidak ikut pindah
    baris({ invoice: "INV-009999999", no_order: "JP/X/1", waktu: "09:40:00" }),
  ];
  const { rows } = siapkan(raw, EVENT);
  assert.deepEqual(
    rows.map((r) => [r.tanggal, r.waktu, r.sesi, r.tanggal_tercatat]),
    [
      ["2026-10-30", "09:36:00", "1-1", "2026-10-31"],
      ["2026-10-30", "10:55:00", "1-1", "2026-10-31"],
      ["2026-10-31", "09:40:00", "2-1", null],
    ],
  );
});

test("koreksi: nomor yang sama di tanggal lain tidak dipindah", () => {
  const benar = createKoreksi([
    { dari: "2026-10-31", ke: "2026-10-30", transaksi: ["INV-1"] },
  ]);
  assert.equal(
    benar({ invoice: "INV-1", tanggal: "2026-10-31" }),
    "2026-10-30",
  );
  assert.equal(benar({ invoice: "INV-1", tanggal: "2026-11-01" }), null);
  assert.equal(benar({ invoice: "INV-2", tanggal: "2026-10-31" }), null);
});
