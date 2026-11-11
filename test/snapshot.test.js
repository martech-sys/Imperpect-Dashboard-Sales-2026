"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server/app");
const snapshot = require("../server/snapshot");

const baris = (o) => ({
  tanggal: "2026-10-30",
  waktu: "10:00:00",
  channel: "MAIN IMPERFECT WAREHOUS 2026",
  invoice: "INV-1",
  no_order: "JP/1",
  invoice_number: "INV-1",
  payment_note: "Cash",
  total_bayar: "150000.0000",
  qty: "1",
  total_harga_barang: "150000.0000",
  brand: "HEYMALE",
  sku_produk: "M1",
  nama_produk: "TEE",
  kategori: null,
  warna: null,
  ukuran: null,
  promo_kode: null,
  promo_value: "0",
  status: "COMPLETED",
  ...o,
});

async function panggil(app, url) {
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(b) {
      this.body = b;
    },
  };
  await app.handle({ url, method: "GET", headers: {} }, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test("snapshot: data terkunci dipakai tanpa membuka database", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  const file = path.join(dir, "snap.json.gz");
  fs.writeFileSync(
    file,
    snapshot.buatSnapshot([
      baris({}),
      baris({
        invoice: "INV-2",
        invoice_number: "INV-2",
        no_order: "JP/2",
        waktu: "13:30:00",
        brand: "HEYLOCAL",
      }),
    ]),
  );
  // Pool palsu: kalau sampai dipanggil, tes gagal
  class PoolTerlarang {
    query() {
      throw new Error("database tidak boleh dibaca saat data terkunci");
    }
    on() {}
    end() {}
  }
  const app = createApp(
    { DATABASE_HOST: "db.contoh", DATABASE_PASSWORD: "x" },
    { Pool: PoolTerlarang, snapshotFile: file },
  );
  try {
    const p = await panggil(app, "/api/pivot");
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.total, { qty: 2, trx: 2, gmv: 300000 });
    assert.equal(p.body.kesegaran.sumber, "snapshot");
    assert.ok(p.body.kesegaran.diambil);
    const info = await panggil(app, "/api/kunci-data");
    assert.equal(info.body.terkunci, true);
    assert.equal(info.body.jumlah, 2);
    // menjalankan kunci ulang butuh login admin stok
    assert.equal((await panggil(app, "/api/kunci-data?ya=1")).status, 403);
    assert.equal((await panggil(app, "/api/health")).body.mode, "snapshot");
  } finally {
    await app.close();
  }
});

test("DATA_LIVE=1 mengabaikan snapshot", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  const file = path.join(dir, "snap.json.gz");
  fs.writeFileSync(file, snapshot.buatSnapshot([baris({})]));
  const app = createApp(
    { DEMO_MODE: "1", DATA_LIVE: "1" },
    { snapshotFile: file },
  );
  try {
    const p = await panggil(app, "/api/pivot");
    assert.equal(p.body.kesegaran.sumber, "demo");
    assert.equal((await panggil(app, "/api/kunci-data")).body.terkunci, false);
  } finally {
    await app.close();
  }
});

test("simpanKeGithub: PUT file gzip dengan sha lama", async () => {
  const panggilan = [];
  const ambil = async (url, opts = {}) => {
    panggilan.push([
      opts.method || "GET",
      url,
      opts.body && JSON.parse(opts.body),
    ]);
    if (!opts.method) return { ok: true, json: async () => ({ sha: "lama" }) };
    return {
      ok: true,
      json: async () => ({
        commit: { html_url: "https://github.com/x/commit/1" },
      }),
    };
  };
  const buf = snapshot.buatSnapshot([baris({})]);
  const url = await snapshot.simpanKeGithub(
    { token: "t", repo: "a/b", branch: "main" },
    buf,
    "kunci",
    ambil,
  );
  assert.equal(url, "https://github.com/x/commit/1");
  assert.equal(panggilan[1][0], "PUT");
  assert.match(
    panggilan[1][1],
    /contents\/data\/snapshot-penjualan\.json\.gz$/,
  );
  assert.equal(panggilan[1][2].sha, "lama");
  assert.equal(
    Buffer.from(panggilan[1][2].content, "base64").length,
    buf.length,
  );
});
