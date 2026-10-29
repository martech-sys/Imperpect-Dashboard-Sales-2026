"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ringkasanAll } = require("../server/ringkasan");
const { createApp } = require("../server/app");

const baris = (o) => ({
  qty: 1,
  total_harga_barang: 100000,
  invoice: "A",
  channel: "MAIN",
  brand: "HEYMALE",
  ...o,
});

const INTERNAL = [
  baris({ invoice: "A", brand: "HEYMALE", total_harga_barang: 100000 }),
  baris({ invoice: "A", brand: "Klamby", qty: 2, total_harga_barang: 300000 }),
  baris({
    invoice: "B",
    channel: "TEBUS",
    brand: "HEYMALE",
    total_harga_barang: 50000,
  }),
];

const EKSTERNAL = [
  {
    brand: "  klamby ",
    diubah: null,
    error: null,
    records: [
      {
        baris: 2,
        phone: "081234567890",
        name: "Dewi",
        qty: "1",
        value: "200000",
      },
    ],
  },
  {
    brand: "Rurik",
    diubah: null,
    error: null,
    records: [{ baris: 2, phone: "", name: "", qty: "2", value: "350.000" }],
  },
  { brand: "Casio", diubah: null, error: null, records: [] },
];

test("gabungan: total = internal + eksternal, brand bernama sama jadi satu baris", () => {
  const r = ringkasanAll({ internalRows: INTERNAL, eksternalFiles: EKSTERNAL });
  assert.deepEqual(r.total, {
    qty: 7,
    trx: 4,
    gmv: 1000000,
    aov: 250000,
    brand: 3,
  });
  assert.equal(r.internal.gmv, 450000);
  assert.equal(r.internal.kontribusi, 45);
  assert.deepEqual(
    r.internal.channels.map((c) => [c.nama, c.trx, c.gmv]),
    [
      ["MAIN", 1, 400000],
      ["TEBUS", 1, 50000],
    ],
  );
  assert.equal(r.eksternal.gmv, 550000);
  assert.equal(r.eksternal.brand, 2);
  assert.deepEqual(
    r.brands.map((b) => [
      b.brand,
      b.sumber,
      b.trx,
      b.gmvInternal,
      b.gmvEksternal,
      b.gmv,
    ]),
    [
      ["Klamby", "keduanya", 2, 300000, 200000, 500000],
      ["Rurik", "eksternal", 1, 0, 350000, 350000],
      ["HEYMALE", "internal", 2, 150000, 0, 150000],
    ],
  );
});

test("satu sumber belum terbaca: sumber lain tetap tampil", () => {
  const r = ringkasanAll({ internalRows: null, eksternalFiles: EKSTERNAL });
  assert.equal(r.internal, null);
  assert.equal(r.total.gmv, 550000);
  assert.equal(r.eksternal.kontribusi, 100);
});

class PoolGagal {
  on() {}
  async query() {
    throw new Error("connect ECONNREFUSED");
  }
  async end() {}
}

function panggil(app, url) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      end: (isi) => resolve({ status: res.statusCode, json: JSON.parse(isi) }),
    };
    app.handle({ url, method: "GET", headers: {}, socket: {} }, res);
  });
}

test("/api/ringkasan: warehouse gagal, eksternal tetap tampil dan galat disebut", async () => {
  const app = createApp(
    { DATABASE_HOST: "db", UJI_WAREHOUSE: "off" },
    { Pool: PoolGagal },
  );
  const r = await panggil(app, "/api/ringkasan");
  assert.equal(r.status, 200);
  assert.equal(r.json.internal, null);
  assert.match(r.json.galat.internal, /ECONNREFUSED/);
  assert.equal(r.json.galat.eksternal, null);
  assert.ok(r.json.eksternal.gmv > 0);
});
