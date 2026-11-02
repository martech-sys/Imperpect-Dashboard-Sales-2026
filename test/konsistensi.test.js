"use strict";

/**
 * Cek silang antarmenu (mode demo): angka yang sama harus sama di setiap
 * menu, dan jumlah per baris/kolom harus sama dengan totalnya.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");

let app;
async function get(url) {
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
  assert.equal(res.statusCode, 200, url);
  return JSON.parse(res.body);
}

const jumlah = (list, k) => list.reduce((a, x) => a + x[k], 0);
const tiga = (o) => ({ qty: o.qty, trx: o.trx, gmv: o.gmv });

test.before(() => {
  app = createApp({ DEMO_MODE: "1" });
});
test.after(() => app.close());

test("internal: Pivot = Rincian Transaksi = Ringkasan All = Compare (unit/TRX)", async () => {
  const pivot = await get("/api/pivot");
  const trx = await get("/api/transactions");
  const all = await get("/api/ringkasan");
  const cmp = await get("/api/compare");
  assert.deepEqual(trx.summary, pivot.total);
  assert.deepEqual(tiga(all.internal), pivot.total);
  assert.equal(cmp.ringkas.v26.unit, pivot.total.qty);
  assert.equal(cmp.ringkas.v26.trx, pivot.total.trx);
  assert.equal(
    jumlah(all.internal.channels, "gmv"),
    pivot.total.gmv,
    "channel Ringkasan All",
  );
});

test("pivot: jumlah baris & kolom = total untuk setiap pilihan baris", async () => {
  for (const baris of ["sesi", "hari", "brand", "jam"]) {
    const p = await get(`/api/pivot?baris=${baris}`);
    assert.equal(
      jumlah(
        p.rows.map((r) => r.total),
        "qty",
      ),
      p.total.qty,
      baris,
    );
    assert.equal(
      jumlah(
        p.rows.map((r) => r.total),
        "gmv",
      ),
      p.total.gmv,
      baris,
    );
    assert.equal(jumlah(p.columns, "qty"), p.total.qty, baris);
    assert.equal(jumlah(p.columns, "gmv"), p.total.gmv, baris);
    p.rows.forEach((r) => {
      const sel = Object.values(r.cells);
      assert.equal(jumlah(sel, "gmv"), r.total.gmv, `${baris} ${r.label}`);
      assert.equal(jumlah(sel, "qty"), r.total.qty, `${baris} ${r.label}`);
    });
  }
});

test("pivot: total hari = jumlah sesinya; baris sesi = Rincian Transaksi sesi itu", async () => {
  const perSesi = await get("/api/pivot?baris=sesi");
  const perHari = await get("/api/pivot?baris=hari");
  perHari.rows.forEach((h) => {
    const sesi = perSesi.rows.filter(
      (s) => s.filter && Number(s.key.split("-")[0]) === h.filter.hari,
    );
    assert.equal(
      jumlah(
        sesi.map((s) => s.total),
        "gmv",
      ),
      h.total.gmv,
      h.label,
    );
    assert.equal(
      jumlah(
        sesi.map((s) => s.total),
        "qty",
      ),
      h.total.qty,
      h.label,
    );
  });
  for (const s of perSesi.rows.filter((r) => r.filter)) {
    const t = await get(`/api/transactions?sesi=${s.key}`);
    assert.deepEqual(t.summary, s.total, s.label);
  }
});

test("pivot filter brand: jumlah semua brand = total", async () => {
  const p = await get("/api/pivot");
  let gmv = 0;
  let qty = 0;
  for (const b of p.options.brands) {
    const pb = await get(`/api/pivot?brand=${encodeURIComponent(b)}`);
    gmv += pb.total.gmv;
    qty += pb.total.qty;
  }
  assert.equal(gmv, p.total.gmv);
  assert.equal(qty, p.total.qty);
});

test("target: aktual brand target + brand di luar target = GMV internal", async () => {
  const pivot = await get("/api/pivot");
  const { target } = await get("/api/target");
  const aktual =
    jumlah(target.brands, "aktual") + jumlah(target.luarTarget, "gmv");
  assert.equal(aktual, pivot.total.gmv);
  // aktual per sesi tidak melebihi aktual brand
  target.brands.forEach((b) => {
    const perSesi = target.sesi.reduce(
      (a, s) => a + (s.aktual[b.kunci] || 0),
      0,
    );
    assert.ok(perSesi <= b.aktual, b.brand);
  });
});

test("eksternal: ringkasan = jumlah detail tiap brand; Ringkasan All = internal + eksternal", async () => {
  const eks = await get("/api/eksternal");
  const all = await get("/api/ringkasan");
  let trx = 0;
  let qty = 0;
  let gmv = 0;
  for (const b of eks.brands) {
    const d = await get(
      `/api/eksternal/brand?brand=${encodeURIComponent(b.brand)}`,
    );
    const valid = d.rows.filter((r) => r.valid);
    assert.equal(valid.length, d.trx, b.brand);
    assert.equal(jumlah(valid, "nilai"), d.gmv, b.brand);
    assert.equal(d.gmv, b.gmv, b.brand);
    trx += d.trx;
    qty += d.qty;
    gmv += d.gmv;
  }
  assert.equal(eks.summary.gmv, gmv);
  assert.equal(eks.summary.trx, trx);
  assert.equal(eks.summary.qty, qty);

  assert.equal(all.total.gmv, all.internal.gmv + all.eksternal.gmv);
  assert.equal(all.total.trx, all.internal.trx + all.eksternal.trx);
  assert.equal(all.total.qty, all.internal.qty + all.eksternal.qty);
  assert.equal(all.eksternal.gmv, eks.summary.gmv);
  assert.equal(jumlah(all.brands, "gmv"), all.total.gmv);
  // invoice berisi beberapa brand dihitung di tiap brand, sekali di total
  assert.ok(jumlah(all.brands, "trx") >= all.total.trx);
});
