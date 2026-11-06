"use strict";

/**
 * Dashboard stok: dibaca dari tabel `stock_sum_new` (satu baris per SKU per
 * gudang) di database warehouse yang sama dengan data penjualan.
 *
 * Metrik per kode tag:
 *   Stock = jumlah stok seluruh SKU di kode tag itu (gudang yang dipilih).
 *   ATP   = (jumlah SKU yang stoknya > 0 / jumlah SKU di kode tag) × 100%.
 *   Stock value = Σ stok SKU × price (harga jual); stok minus dihitung 0.
 *   Kelas dari tabel article_class (join lewat kode_tag).
 * HPP tidak dibaca.
 * Stok satu SKU = jumlah stoknya di semua gudang yang dipilih, jadi SKU yang
 * kosong di satu gudang tetapi ada di gudang lain tetap dihitung tersedia.
 *
 * Login terpisah dari dashboard penjualan (username + password sendiri).
 * Password disimpan sebagai hash scrypt, bukan teks asli; ganti lewat
 * STOCK_PASSWORD atau STOCK_PASSWORD_HASH di Vercel.
 */

const { createPool } = require("./source-postgres");

const TANPA_TAG = "(tanpa kode tag)";
const TANPA_SKU = "(tanpa SKU)";

// Teks angka yang sah saja yang di-cast, supaya satu nilai aneh tidak
// menggagalkan seluruh query.
const angkaSql = (kolom) =>
  `CASE WHEN btrim(${kolom}::text) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN btrim(${kolom}::text)::numeric END`;

const TANPA_KELAS = "(tanpa kelas)";

/**
 * Kelas tiap kode tag dari tabel article_class (satu kode tag bisa punya
 * beberapa baris periode): dipilih baris yang aktif (is_active), lalu yang
 * start_date-nya paling baru. Kode tag dicocokkan tanpa memedulikan spasi di
 * tepi dan huruf besar/kecil.
 */
function buildStockQuery(cfg) {
  const nama = (t) => (cfg.schema ? `"${cfg.schema}".${t}` : t);
  const kunci = (k) => `upper(btrim(${k}))`;
  return `WITH kelas AS (
  SELECT DISTINCT ON (${kunci("kode_tag")})
         ${kunci("kode_tag")} AS kunci,
         NULLIF(btrim(kelas::text), '') AS kelas
    FROM ${nama(cfg.tabelKelas || "article_class")}
   WHERE NULLIF(btrim(kode_tag), '') IS NOT NULL
   ORDER BY ${kunci("kode_tag")},
         (lower(btrim(is_active::text)) IN ('true', 't', '1', 'y', 'yes', 'aktif', 'active')) DESC,
         start_date DESC NULLS LAST
)
SELECT COALESCE(NULLIF(btrim(s.kode_tag), ''), '${TANPA_TAG}') AS kode_tag,
       MAX(s.name_tag) AS name_tag,
       COALESCE(NULLIF(btrim(s.sku_product), ''), '${TANPA_SKU}') AS sku_product,
       MAX(s.product_name) AS product_name,
       MAX(s.color) AS color,
       MAX(s."size") AS size,
       MAX(${angkaSql("s.price")}) AS price,
       COALESCE(MAX(NULLIF(btrim(s.principal_brand), '')), MAX(s.brand)) AS brand,
       MAX(s.kategori) AS kategori,
       MAX(k.kelas) AS kelas,
       COALESCE(NULLIF(btrim(s.warehouse), ''), '(tanpa gudang)') AS warehouse,
       MAX(s.status) AS status,
       SUM(COALESCE(${angkaSql("s.stock")}, 0)) AS stock
  FROM ${nama(cfg.tabel)} s
  LEFT JOIN kelas k ON k.kunci = ${kunci("s.kode_tag")}
 GROUP BY 1, 3, 11`;
}

function createStockSource(cfg, deps = {}) {
  const pool = createPool(cfg.pg, { ...deps, maxConnections: 1 });
  const sql = buildStockQuery(cfg);
  return {
    name: "postgres",
    async fetch() {
      const res = await pool.query(sql);
      return res.rows;
    },
    close: () => pool.end(),
  };
}

// ---------------------------------------------------------------------------
// Data contoh (mode demo)
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createDemoStockSource() {
  const acak = mulberry32(2026);
  const brand = ["HEYMALE", "HEYLOCAL", "BOONABOO", "PREPPSTUDIO"];
  const nama = ["BASIC TEE", "CHINO PANTS", "SCARF", "TOTEBAG", "JACKET"];
  const gudang = ["GUDANG PUSAT", "TOKO KEMANG"];
  const ukuran = ["S", "M", "L", "XL"];
  const rows = [];
  for (let t = 1; t <= 36; t += 1) {
    const b = brand[t % brand.length];
    const kode = `${b.slice(0, 2)}T${String(t).padStart(4, "0")}`;
    const n = `${nama[t % nama.length]} ${t}`;
    const warna = ["BLACK", "NAVY", "CREAM"][t % 3];
    // sebagian kode tag sengaja habis semua / lengkap semua
    const pola = t % 6;
    ukuran.slice(0, 2 + (t % 3)).forEach((u, i) => {
      const sku = `${kode}${warna.slice(0, 2)}${u}`;
      gudang.forEach((g, gi) => {
        let stock = Math.floor(acak() * 12) - 2;
        if (pola === 0) stock = 0;
        if (pola === 1) stock = 3 + gi + i;
        rows.push({
          kode_tag: kode,
          name_tag: n,
          sku_product: sku,
          product_name: `${n} ${warna} ${u}`,
          color: warna,
          size: u,
          price: String(99000 + (t % 5) * 50000),
          kelas: ["A", "B", "C", null][t % 4],
          brand: b,
          kategori: t % 2 ? "APPAREL" : "ACCESSORIES",
          warehouse: g,
          status: t % 9 === 0 ? "INACTIVE" : "ACTIVE",
          stock: String(Math.max(stock, 0)),
        });
      });
    });
  }
  return { name: "demo", fetch: async () => rows, close: async () => {} };
}

// ---------------------------------------------------------------------------
// Agregasi
// ---------------------------------------------------------------------------

const teks = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t || null;
};

const angka = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Baris query → baris rapi. */
function siapkanStok(raw) {
  return raw.map((r) => ({
    kode_tag: teks(r.kode_tag) || TANPA_TAG,
    name_tag: teks(r.name_tag),
    sku: teks(r.sku_product) || TANPA_SKU,
    nama: teks(r.product_name),
    warna: teks(r.color),
    ukuran: teks(r.size),
    harga: angka(r.price),
    kelas: teks(r.kelas) || TANPA_KELAS,
    brand: teks(r.brand) || "(tanpa brand)",
    kategori: teks(r.kategori) || "(tanpa kategori)",
    warehouse: teks(r.warehouse) || "(tanpa gudang)",
    status: teks(r.status) || "(tanpa status)",
    stock: angka(r.stock) || 0,
  }));
}

function bacaFilterStok(query) {
  const ambil = (k) => {
    const v = query[k];
    const t = Array.isArray(v) ? v[0] : v;
    return typeof t === "string" ? t.trim() : "";
  };
  return {
    warehouse: ambil("warehouse"),
    brand: ambil("brand"),
    kategori: ambil("kategori"),
    kelas: ambil("kelas"),
    status: ambil("status"),
    atp: ambil("atp"), // "", "habis" (0%), "sebagian", "penuh" (100%)
    q: ambil("q").toLowerCase().slice(0, 100),
  };
}

function saringStok(rows, f) {
  return rows.filter(
    (r) =>
      (!f.warehouse || r.warehouse === f.warehouse) &&
      (!f.brand || r.brand === f.brand) &&
      (!f.kategori || r.kategori === f.kategori) &&
      (!f.kelas || r.kelas === f.kelas) &&
      (!f.status || r.status === f.status),
  );
}

const persen = (ada, total) => (total ? (ada / total) * 100 : 0);

/** Baris (sudah disaring) → Map kode tag → { info, sku: Map sku → {..., stock, gudang} }. */
function kelompokTag(rows) {
  const tags = new Map();
  rows.forEach((r) => {
    let t = tags.get(r.kode_tag);
    if (!t) {
      t = {
        kode_tag: r.kode_tag,
        name_tag: r.name_tag,
        brand: r.brand,
        kategori: r.kategori,
        kelas: r.kelas,
        sku: new Map(),
      };
      tags.set(r.kode_tag, t);
    }
    if (!t.name_tag && r.name_tag) t.name_tag = r.name_tag;
    let s = t.sku.get(r.sku);
    if (!s) {
      s = {
        sku: r.sku,
        nama: r.nama,
        warna: r.warna,
        ukuran: r.ukuran,
        harga: r.harga,
        status: r.status,
        stock: 0,
        gudang: [],
      };
      t.sku.set(r.sku, s);
    }
    s.stock += r.stock;
    s.gudang.push({ warehouse: r.warehouse, stock: r.stock });
  });
  return tags;
}

/** Nilai stok satu SKU: stok (minus = 0) × harga. */
const nilaiSku = (s) => Math.max(s.stock, 0) * (s.harga || 0);

function ringkasTag(t) {
  const daftar = [...t.sku.values()];
  const totalSku = daftar.length;
  const skuAda = daftar.filter((s) => s.stock > 0).length;
  return {
    kode_tag: t.kode_tag,
    name_tag: t.name_tag || "",
    brand: t.brand,
    kategori: t.kategori,
    kelas: t.kelas,
    stock: Math.round(daftar.reduce((a, s) => a + s.stock, 0)),
    nilai: Math.round(daftar.reduce((a, s) => a + nilaiSku(s), 0)),
    total_sku: totalSku,
    sku_ada: skuAda,
    atp: persen(skuAda, totalSku),
  };
}

const URUT_STOK = new Set([
  "kode_tag",
  "name_tag",
  "stock",
  "nilai",
  "kelas",
  "atp",
  "total_sku",
]);

/** Daftar kode tag + KPI (tab utama). */
function daftarTag(rows, query) {
  const f = bacaFilterStok(query);
  const tags = kelompokTag(saringStok(rows, f));
  let list = [...tags.values()].map((t) => {
    const r = ringkasTag(t);
    if (f.q) {
      const cocok =
        r.kode_tag.toLowerCase().includes(f.q) ||
        r.name_tag.toLowerCase().includes(f.q) ||
        [...t.sku.values()].some(
          (s) =>
            s.sku.toLowerCase().includes(f.q) ||
            String(s.nama || "")
              .toLowerCase()
              .includes(f.q),
        );
      if (!cocok) return null;
    }
    return r;
  });
  list = list.filter(Boolean);
  if (f.atp === "habis") list = list.filter((t) => t.sku_ada === 0);
  if (f.atp === "sebagian")
    list = list.filter((t) => t.sku_ada > 0 && t.sku_ada < t.total_sku);
  if (f.atp === "penuh")
    list = list.filter((t) => t.total_sku > 0 && t.sku_ada === t.total_sku);

  const totalSku = list.reduce((a, t) => a + t.total_sku, 0);
  const skuAda = list.reduce((a, t) => a + t.sku_ada, 0);
  const summary = {
    kode_tag: list.length,
    total_sku: totalSku,
    sku_ada: skuAda,
    stock: list.reduce((a, t) => a + t.stock, 0),
    nilai: list.reduce((a, t) => a + t.nilai, 0),
    atp: persen(skuAda, totalSku),
    tag_penuh: list.filter((t) => t.total_sku && t.sku_ada === t.total_sku)
      .length,
    tag_habis: list.filter((t) => t.sku_ada === 0).length,
  };

  const sortBy = URUT_STOK.has(query.sortBy) ? query.sortBy : "stock";
  const arah = String(query.sortDir).toLowerCase() === "asc" ? 1 : -1;
  list.sort((a, b) => {
    const x = a[sortBy];
    const y = b[sortBy];
    const beda =
      typeof x === "number"
        ? x - y
        : String(x).localeCompare(String(y), "id", { numeric: true });
    return beda * arah || a.kode_tag.localeCompare(b.kode_tag, "id");
  });

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    500,
    Math.max(1, parseInt(query.pageSize, 10) || 50),
  );
  return {
    summary,
    total: list.length,
    page,
    pageSize,
    sortBy,
    sortDir: arah === 1 ? "asc" : "desc",
    rows: list.slice((page - 1) * pageSize, page * pageSize),
    semua: list,
  };
}

/** Rincian satu kode tag: metrik per SKU (filter gudang/brand/dll tetap berlaku). */
function detailTag(rows, kodeTag, query) {
  const f = bacaFilterStok(query);
  const tags = kelompokTag(
    saringStok(rows, f).filter((r) => r.kode_tag === kodeTag),
  );
  const t = tags.get(kodeTag);
  if (!t) return null;
  const sku = [...t.sku.values()]
    .map((s) => ({
      ...s,
      stock: Math.round(s.stock),
      nilai: Math.round(nilaiSku(s)),
      tersedia: s.stock > 0,
      gudang: s.gudang
        .slice()
        .sort((a, b) => a.warehouse.localeCompare(b.warehouse, "id")),
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku, "id", { numeric: true }));
  return { ...ringkasTag(t), sku };
}

function opsiStok(rows) {
  const ambil = (k) =>
    [...new Set(rows.map((r) => r[k]))].sort((a, b) =>
      a.localeCompare(b, "id"),
    );
  return {
    warehouses: ambil("warehouse"),
    brands: ambil("brand"),
    kategori: ambil("kategori"),
    kelas: ambil("kelas"),
    status: ambil("status"),
  };
}

function csvSel(v) {
  const t = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Ekspor: satu baris per SKU, lengkap dengan kode tag & ATP kode tag-nya. */
function stokCsv(rows, query) {
  const { semua } = daftarTag(rows, { ...query, page: 1, pageSize: 1 });
  const f = bacaFilterStok(query);
  const tags = kelompokTag(saringStok(rows, f));
  const kepala = [
    "kode_tag",
    "name_tag",
    "kelas",
    "atp_kode_tag_persen",
    "sku_product",
    "product_name",
    "color",
    "size",
    "price",
    "stock",
    "stock_value",
  ];
  const baris = [kepala.join(";")];
  semua.forEach((t) => {
    [...tags.get(t.kode_tag).sku.values()]
      .sort((a, b) => a.sku.localeCompare(b.sku, "id", { numeric: true }))
      .forEach((s) => {
        baris.push(
          [
            t.kode_tag,
            t.name_tag,
            t.kelas,
            t.atp.toFixed(1),
            s.sku,
            s.nama,
            s.warna,
            s.ukuran,
            s.harga,
            Math.round(s.stock),
            Math.round(nilaiSku(s)),
          ]
            .map(csvSel)
            .join(";"),
        );
      });
  });
  return `﻿${baris.join("\n")}`;
}

module.exports = {
  TANPA_TAG,
  TANPA_KELAS,
  buildStockQuery,
  createStockSource,
  createDemoStockSource,
  siapkanStok,
  daftarTag,
  detailTag,
  opsiStok,
  stokCsv,
};
