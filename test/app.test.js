"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");

/** Permintaan tiruan yang cukup untuk handler: url, method, headers, body. */
function panggil(app, { url, method = "GET", cookie, body }) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => (headers[k.toLowerCase()] = v),
      end: (isi) => {
        const teks = isi === undefined ? "" : String(isi);
        const json = (headers["content-type"] || "").includes("json")
          ? JSON.parse(teks)
          : null;
        resolve({ status: res.statusCode, headers, teks, json });
      },
    };
    app.handle(
      { url, method, headers: cookie ? { cookie } : {}, body, socket: {} },
      res,
    );
  });
}

class PoolTiruan {
  constructor() {
    PoolTiruan.n = 0;
  }
  on() {}
  async query(sql, params) {
    PoolTiruan.n += 1;
    PoolTiruan.params = params;
    if (PoolTiruan.gagal) throw new Error("connect ECONNREFUSED");
    return {
      rows: [
        {
          tanggal: "2026-10-30",
          waktu: "09:10:00",
          channel: "MAIN IMPERFECT WAREHOUS 2026",
          invoice: "A",
          qty: "1",
          total_harga_barang: "100000",
          hpp: "30000",
          brand: "X",
          status: "Delivery",
        },
      ],
    };
  }
  async end() {}
}

const ENV_DB = {
  DATABASE_HOST: "db",
  DATABASE_NAME: "we_data_store",
  CACHE_SECONDS: "60",
};

test("tanpa database: mode demo, data contoh terbaca", async () => {
  const app = createApp({});
  const info = await panggil(app, { url: "/api/app" });
  assert.equal(info.json.mode, "demo");
  assert.equal(info.json.auth.aktif, false);
  const p = await panggil(app, { url: "/api/pivot" });
  assert.equal(p.status, 200);
  assert.ok(p.json.total.trx > 0);
});

test("Postgres: parameter event dikirim ke query, dibaca sekali per CACHE_SECONDS", async () => {
  PoolTiruan.gagal = false;
  const app = createApp(ENV_DB, { Pool: PoolTiruan });
  await panggil(app, { url: "/api/pivot" });
  await panggil(app, { url: "/api/transactions" });
  await panggil(app, { url: "/api/pivot?brand=X" });
  assert.equal(PoolTiruan.n, 1);
  assert.deepEqual(PoolTiruan.params, [
    ["MAIN IMPERFECT WAREHOUS 2026", "TEBUS MURAH IMPERFECT 2026"],
    "2026-10-30",
    "2026-11-01",
  ]);
});

test("database gagal sejak awal: 503 dengan pesan aslinya, bukan data contoh", async () => {
  PoolTiruan.gagal = true;
  const app = createApp(ENV_DB, { Pool: PoolTiruan });
  const p = await panggil(app, { url: "/api/pivot" });
  assert.equal(p.status, 503);
  assert.match(p.json.message, /ECONNREFUSED/);
  PoolTiruan.gagal = false;
});

test("gerbang password: data tertutup sebelum masuk, HPP hanya setelah masuk", async () => {
  const app = createApp(
    { ...ENV_DB, DASHBOARD_PASSWORD: "Rh#4s!" },
    { Pool: PoolTiruan },
  );
  assert.equal((await panggil(app, { url: "/api/pivot" })).status, 401);
  assert.equal(
    (await panggil(app, { url: "/api/transactions.csv" })).status,
    401,
  );

  const salah = await panggil(app, {
    url: "/api/auth/login",
    method: "POST",
    body: { password: "x" },
  });
  assert.equal(salah.status, 401);
  const benar = await panggil(app, {
    url: "/api/auth/login",
    method: "POST",
    body: { password: "Rh#4s!" },
  });
  assert.equal(benar.status, 200);
  const cookie = benar.headers["set-cookie"].split(";")[0];

  const trx = await panggil(app, { url: "/api/transactions", cookie });
  assert.equal(trx.status, 200);
  assert.equal(trx.json.rows[0].hpp, 30000);

  // Cookie palsu ditolak.
  const palsu = await panggil(app, {
    url: "/api/pivot",
    cookie: "isd_sesi=9999999999.abc",
  });
  assert.equal(palsu.status, 401);
});

test("tanpa password: HPP tidak pernah dikirim", async () => {
  const app = createApp(ENV_DB, { Pool: PoolTiruan });
  const trx = await panggil(app, { url: "/api/transactions" });
  assert.ok(!("hpp" in trx.json.rows[0]));
  const csv = await panggil(app, { url: "/api/transactions.csv" });
  assert.ok(!csv.teks.includes("hpp"));
});

test("konfigurasi salah dilaporkan di setiap endpoint", async () => {
  const app = createApp({ EVENT_SESI: "Day 1: 10.00-09.00" });
  const r = await panggil(app, { url: "/api/app" });
  assert.equal(r.status, 500);
  assert.match(r.json.message, /EVENT_SESI/);
});
