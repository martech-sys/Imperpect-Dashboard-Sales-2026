"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");
const stok = require("../server/stock");

const baris = (o) => ({
  kode_tag: "T1",
  name_tag: "TEE",
  sku_product: "S1",
  product_name: "TEE BLACK S",
  color: "BLACK",
  size: "S",
  price: "99000",
  kelas: "A",
  brand: "HEYMALE",
  kategori: "APPAREL",
  warehouse: "A",
  status: "ACTIVE",
  stock: "0",
  ...o,
});

const RAW = [
  // T1: S1 ada di gudang B saja, S2 habis, S3 ada, S4 minus (tidak tersedia)
  baris({ sku_product: "S1", warehouse: "A", stock: "0" }),
  baris({ sku_product: "S1", warehouse: "B", stock: "4" }),
  baris({ sku_product: "S2", warehouse: "A", stock: "0" }),
  baris({ sku_product: "S3", warehouse: "A", stock: "2" }),
  baris({ sku_product: "S4", warehouse: "A", stock: "-1" }),
  // T2: semua ada
  baris({ kode_tag: "T2", name_tag: "SCARF", sku_product: "X1", stock: "5" }),
  baris({ kode_tag: "T2", name_tag: "SCARF", sku_product: "X2", stock: "1" }),
  // T3: semua habis
  baris({
    kode_tag: "T3",
    name_tag: "BAG",
    sku_product: "Y1",
    stock: "0",
    kelas: null,
  }),
];
const rows = stok.siapkanStok(RAW);

test("ATP = SKU stok > 0 / total SKU kode tag × 100%", () => {
  const r = stok.daftarTag(rows, { sortBy: "kode_tag", sortDir: "asc" });
  assert.deepEqual(
    r.rows.map((t) => [t.kode_tag, t.total_sku, t.sku_ada, t.stock, t.atp]),
    [
      ["T1", 4, 2, 5, 50],
      ["T2", 2, 2, 6, 100],
      ["T3", 1, 0, 0, 0],
    ],
  );
  assert.equal(r.summary.total_sku, 7);
  assert.equal(r.summary.sku_ada, 4);
  assert.ok(Math.abs(r.summary.atp - (4 / 7) * 100) < 1e-9);
  assert.equal(r.summary.tag_penuh, 1);
  assert.equal(r.summary.tag_habis, 1);
  // stock value = Σ stok × price; T1 6 pcs, T2 6 pcs (stok minus = 0)
  assert.equal(r.summary.nilai, 12 * 99000);
  assert.equal(
    stok.daftarTag(rows, { sortBy: "nilai", sortDir: "desc" }).rows[0].nilai,
    6 * 99000,
  );
});

test("filter gudang: stok & ATP hanya dari gudang itu", () => {
  const r = stok.daftarTag(rows, {
    warehouse: "A",
    sortBy: "kode_tag",
    sortDir: "asc",
  });
  assert.deepEqual(r.rows[0], {
    kode_tag: "T1",
    name_tag: "TEE",
    brand: "HEYMALE",
    kategori: "APPAREL",
    kelas: "A",
    stock: 1,
    // stok minus (S4) tidak mengurangi nilai: 2 × harga
    nilai: 198000,
    total_sku: 4,
    sku_ada: 1,
    atp: 25,
  });
  assert.equal(stok.daftarTag(rows, { atp: "habis" }).total, 1);
  assert.equal(stok.daftarTag(rows, { atp: "penuh" }).total, 1);
  assert.equal(stok.daftarTag(rows, { q: "x2" }).rows[0].kode_tag, "T2");
});

test("kelas: ikut di baris kode tag, opsi filter, dan bisa disaring", () => {
  const r = stok.daftarTag(rows, { sortBy: "kode_tag", sortDir: "asc" });
  assert.deepEqual(
    r.rows.map((t) => [t.kode_tag, t.kelas]),
    [
      ["T1", "A"],
      ["T2", "A"],
      ["T3", stok.TANPA_KELAS],
    ],
  );
  assert.deepEqual(stok.opsiStok(rows).kelas, ["(tanpa kelas)", "A"]);
  assert.deepEqual(
    stok
      .daftarTag(rows, { kelas: "A" })
      .rows.map((t) => t.kode_tag)
      .sort(),
    ["T1", "T2"],
  );
});

test("detail kode tag: metrik per SKU dengan stok per gudang", () => {
  const d = stok.detailTag(rows, "T1", {});
  assert.equal(d.atp, 50);
  assert.deepEqual(
    d.sku.map((s) => [s.sku, s.stock, s.tersedia, s.gudang.length, s.nilai]),
    [
      ["S1", 4, true, 2, 4 * 99000],
      ["S2", 0, false, 1, 0],
      ["S3", 2, true, 1, 2 * 99000],
      ["S4", -1, false, 1, 0],
    ],
  );
  assert.equal(stok.detailTag(rows, "TIDAK-ADA", {}), null);
});

test("query stok: per kode tag × SKU × gudang dari stock_sum_new", () => {
  const sql = stok.buildStockQuery({ tabel: "stock_sum_new", schema: "" });
  assert.match(sql, /FROM stock_sum_new/);
  assert.match(sql, /GROUP BY 1, 3, 11/);
  assert.doesNotMatch(sql, /hpp/);
  assert.match(sql, /<> ALL\(\$1::text\[\]\)/);
  assert.deepEqual(stok.kecualiTag([" test ", "", "Uji"]), ["TEST", "UJI"]);
  // kelas dari article_class, join lewat kode_tag (baris aktif & terbaru)
  assert.match(sql, /FROM article_class/);
  assert.match(
    sql,
    /LEFT JOIN kelas k ON k\.kunci = upper\(btrim\(s\.kode_tag\)\)/,
  );
  assert.match(sql, /is_active/);
  assert.match(sql, /sku_product/);
});

async function panggil(app, url, { method = "GET", body, cookie } = {}) {
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(b) {
      this.body = b;
    },
  };
  await app.handle(
    { url, method, headers: cookie ? { cookie } : {}, body },
    res,
  );
  const ct = res.headers["Content-Type"] || "";
  return {
    status: res.statusCode,
    headers: res.headers,
    body: ct.includes("json") ? JSON.parse(res.body) : res.body,
  };
}

test("login stok: username + password sendiri, terpisah dari dashboard penjualan", async () => {
  const app = createApp({
    DEMO_MODE: "1",
    DASHBOARD_PASSWORD: "jualan",
    STOCK_PASSWORD: "uji-stok",
  });
  try {
    assert.equal((await panggil(app, "/api/stock")).status, 401);
    assert.equal((await panggil(app, "/api/stock/app")).body.auth.masuk, false);
    const salah = await panggil(app, "/api/stock/login", {
      method: "POST",
      body: { username: "stockwh", password: "salah" },
    });
    assert.equal(salah.status, 401);
    const userSalah = await panggil(app, "/api/stock/login", {
      method: "POST",
      body: { username: "admin", password: "uji-stok" },
    });
    assert.equal(userSalah.status, 401);
    const ok = await panggil(app, "/api/stock/login", {
      method: "POST",
      body: { username: "stockwh", password: "uji-stok" },
    });
    assert.equal(ok.status, 200);
    const cookie = ok.headers["Set-Cookie"].split(";")[0];
    assert.match(cookie, /^isd_stok=/);

    const list = await panggil(app, "/api/stock", { cookie });
    assert.equal(list.status, 200);
    assert.ok(list.body.rows.length > 0);
    assert.ok(list.body.options.warehouses.length > 0);
    const kode = list.body.rows[0].kode_tag;
    const detail = await panggil(
      app,
      `/api/stock/tag?kode_tag=${encodeURIComponent(kode)}`,
      { cookie },
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.sku.length, list.body.rows[0].total_sku);
    const csv = await panggil(app, "/api/stock.csv", { cookie });
    assert.match(
      csv.body,
      /kode_tag;name_tag;kelas;atp_kode_tag_persen;sku_product/,
    );
    assert.match(csv.body, /stock;stock_value$/m);
    assert.doesNotMatch(csv.body, /hpp/);

    // cookie stok tidak membuka dashboard penjualan, dan sebaliknya
    assert.equal((await panggil(app, "/api/pivot", { cookie })).status, 401);
  } finally {
    await app.close();
  }
});

test("tanpa STOCK_PASSWORD login stok mati dan data tertutup", async () => {
  const app = createApp({ DEMO_MODE: "1" });
  try {
    const info = await panggil(app, "/api/stock/app");
    assert.equal(info.body.auth.aktif, false);
    assert.equal((await panggil(app, "/api/stock")).status, 503);
    const login = await panggil(app, "/api/stock/login", {
      method: "POST",
      body: { username: "stockwh", password: "apa saja" },
    });
    assert.equal(login.status, 503);
  } finally {
    await app.close();
  }
});

test("STOCK_USERNAME / STOCK_PASSWORD_HASH dari env", async () => {
  const { cocokHash } = require("../server/auth");
  const crypto = require("node:crypto");
  const hash = [
    "scrypt",
    "garam",
    crypto.scryptSync("rahasia", "garam", 32).toString("base64url"),
  ].join(":");
  assert.ok(cocokHash("rahasia", hash));
  assert.ok(!cocokHash("salah", hash));
  const app = createApp({
    DEMO_MODE: "1",
    STOCK_USERNAME: "gudang",
    STOCK_PASSWORD_HASH: hash,
  });
  try {
    const lama = await panggil(app, "/api/stock/login", {
      method: "POST",
      body: { username: "stockwh", password: "rahasia" },
    });
    assert.equal(lama.status, 401);
    const baru = await panggil(app, "/api/stock/login", {
      method: "POST",
      body: { username: "Gudang", password: "rahasia" },
    });
    assert.equal(baru.status, 200);
  } finally {
    await app.close();
  }
});
