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
    PoolTiruan.sql = sql;
    PoolTiruan.params = params;
    if (PoolTiruan.gagal) throw new Error("connect ECONNREFUSED");
    // Query mode uji mendapat baris dari gudang & tahun lama.
    const uji = /LIMIT/.test(sql);
    return {
      rows: [
        {
          tanggal: uji ? "2025-11-21" : "2026-10-30",
          waktu: "09:10:00",
          channel: uji ? params[0] : "MAIN IMPERFECT WAREHOUS 2026",
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
  UJI_WAREHOUSE: "off",
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
  assert.match(PoolTiruan.sql, /principal_brand AS brand/);
  assert.deepEqual(PoolTiruan.params, [
    ["MAIN IMPERFECT WAREHOUS 2026", "TEBUS MURAH IMPERFECT 2026"],
    "2026-10-30",
    "2026-11-01",
  ]);
});

test("mode uji (bawaan): N baris pertama gudang 2025, Day 1 = tanggal pertamanya", async () => {
  PoolTiruan.gagal = false;
  const env = { ...ENV_DB };
  delete env.UJI_WAREHOUSE;
  const app = createApp(env, { Pool: PoolTiruan });
  const info = await panggil(app, { url: "/api/app" });
  assert.deepEqual(info.json.uji, {
    warehouse: "MAIN STAGE IMPERFECT SALE 2025",
    limit: 20,
  });
  const p = await panggil(app, { url: "/api/pivot" });
  assert.deepEqual(PoolTiruan.params, ["MAIN STAGE IMPERFECT SALE 2025", 20]);
  assert.match(PoolTiruan.sql, /LIMIT \$2/);
  assert.deepEqual(
    p.json.columns.map((c) => c.key),
    ["MAIN STAGE IMPERFECT SALE 2025"],
  );
  assert.equal(p.json.kesegaran.uji.limit, 20);
  assert.equal(p.json.options.hari[0].label, "Day 1 · 21 Nov");
  assert.equal(p.json.rows[0].label, "Day 1 | Sesi 1 (09.00-10.00)");
  assert.equal(p.json.total.gmv, 100000);
});

test("UJI_LIMIT mengatur jumlah baris uji", async () => {
  const env = { ...ENV_DB, UJI_WAREHOUSE: "GUDANG LAMA", UJI_LIMIT: "50" };
  const app = createApp(env, { Pool: PoolTiruan });
  await panggil(app, { url: "/api/pivot" });
  assert.deepEqual(PoolTiruan.params, ["GUDANG LAMA", 50]);
});

test("database gagal sejak awal: 503 dengan pesan aslinya, bukan data contoh", async () => {
  PoolTiruan.gagal = true;
  const app = createApp(ENV_DB, { Pool: PoolTiruan });
  const p = await panggil(app, { url: "/api/pivot" });
  assert.equal(p.status, 503);
  assert.match(p.json.message, /ECONNREFUSED/);
  PoolTiruan.gagal = false;
});

test("gerbang password: data tertutup sebelum masuk", async () => {
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
  assert.equal(trx.json.rows[0].brand, "X");

  // Cookie palsu ditolak.
  const palsu = await panggil(app, {
    url: "/api/pivot",
    cookie: "isd_sesi=9999999999.abc",
  });
  assert.equal(palsu.status, 401);
});

test("HPP tidak pernah dikirim, login atau tidak", async () => {
  const app = createApp(ENV_DB, { Pool: PoolTiruan });
  const trx = await panggil(app, { url: "/api/transactions" });
  assert.ok(!("hpp" in trx.json.rows[0]));
  const csv = await panggil(app, { url: "/api/transactions.csv" });
  assert.ok(!csv.teks.includes("hpp"));
  assert.doesNotMatch(PoolTiruan.sql, /\bhpp\b/);
});

test("konfigurasi salah dilaporkan di setiap endpoint", async () => {
  const app = createApp({ EVENT_SESI: "Day 1: 10.00-09.00" });
  const r = await panggil(app, { url: "/api/app" });
  assert.equal(r.status, 500);
  assert.match(r.json.message, /EVENT_SESI/);
});

test("Ringkasan Eksternal: data contoh tanpa DRIVE_FOLDER, tertutup bila belum masuk", async () => {
  const app = createApp({});
  const r = await panggil(app, { url: "/api/eksternal" });
  assert.equal(r.status, 200);
  assert.equal(r.json.kesegaran.sumber, "demo");
  assert.ok(r.json.brands.length > 0);
  const d = await panggil(app, {
    url: `/api/eksternal/brand?brand=${encodeURIComponent(r.json.brands[0].brand)}`,
  });
  assert.equal(d.status, 200);
  assert.equal(
    (await panggil(app, { url: "/api/eksternal/brand?brand=Tidak%20Ada" }))
      .status,
    404,
  );

  const tertutup = createApp({ DASHBOARD_PASSWORD: "rahasia" });
  assert.equal(
    (await panggil(tertutup, { url: "/api/eksternal" })).status,
    401,
  );
});

test("Ringkasan Eksternal: kunci akun layanan salah dilaporkan, bukan diganti data contoh", async () => {
  const app = createApp({
    DRIVE_FOLDER: "FOLDER_ID_123",
    GOOGLE_SERVICE_ACCOUNT_JSON: "{",
  });
  const r = await panggil(app, { url: "/api/eksternal" });
  assert.equal(r.status, 503);
  assert.match(r.json.message, /bukan JSON/);
});

test("cache CDN hanya tanpa gerbang password", async () => {
  const terbuka = createApp({});
  const a = await panggil(terbuka, { url: "/api/pivot" });
  assert.equal(
    a.headers["vercel-cdn-cache-control"],
    "max-age=15, stale-while-revalidate=60",
  );
  // Tombol Refresh (?segar=1) tidak boleh dijawab atau disimpan CDN.
  const segar = await panggil(terbuka, { url: "/api/pivot?segar=1&_=1" });
  assert.equal(segar.headers["vercel-cdn-cache-control"], undefined);
  assert.equal(a.headers["cache-control"], "no-store");
  const info = await panggil(terbuka, { url: "/api/app" });
  assert.equal(info.headers["vercel-cdn-cache-control"], undefined);

  const tertutup = createApp({ DASHBOARD_PASSWORD: "rahasia" });
  const masuk = await panggil(tertutup, {
    url: "/api/auth/login",
    method: "POST",
    body: { password: "rahasia" },
  });
  const cookie = masuk.headers["set-cookie"].split(";")[0];
  const b = await panggil(tertutup, { url: "/api/pivot", cookie });
  assert.equal(b.status, 200);
  assert.equal(b.headers["vercel-cdn-cache-control"], undefined);
});
