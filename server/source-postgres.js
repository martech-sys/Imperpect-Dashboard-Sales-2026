"use strict";

/**
 * Sumber data: tabel `laporan_penjualan` di warehouse `we_data_store`, sama
 * dengan papan TV IMPERPECT-SALES-2026. Bedanya, papan TV hanya butuh satu
 * baris per invoice; dashboard ini butuh baris per produk (brand, SKU, HPP),
 * jadi query-nya mengambil baris apa adanya dan agregasinya dikerjakan di
 * server (server/report.js).
 *
 * Kolom identitas pelanggan (`nama`, `no_hp`) sengaja tidak diambil: dashboard
 * tidak memakainya.
 */

function pilihan(cfg, event) {
  const tabel = cfg.schema
    ? `"${cfg.schema}".laporan_penjualan`
    : "laporan_penjualan";
  // Nama kolom channel sudah dibatasi ke warehouse/channel di config.js.
  return `SELECT to_char(tanggal, 'YYYY-MM-DD') AS tanggal,
       waktu::text AS waktu,
       ${event.kolomChannel} AS channel,
       COALESCE(NULLIF(btrim(invoice_number), ''), no_order) AS invoice,
       payment_note, total_bayar, qty, hpp, total_harga_barang,
       brand, sku_produk,
       COALESCE(NULLIF(btrim(name_tag), ''), nama_produk) AS nama_produk,
       kategori, warna, ukuran, promo_kode, promo_value, status
  FROM ${tabel}`;
}

function buildQuery(cfg, event) {
  return `${pilihan(cfg, event)}
 WHERE warehouse = ANY($1::text[])
   AND tanggal >= $2::date
   AND tanggal < ($3::date + 1)`;
}

/** Mode uji: N baris pertama satu gudang, tanpa batas tanggal. */
function buildQueryUji(cfg, event) {
  return `${pilihan(cfg, event)}
 WHERE warehouse = $1
 ORDER BY tanggal, waktu, invoice_number, sku_produk
 LIMIT $2`;
}

/**
 * Event yang dipakai menghitung hari & sesi data uji: Day 1 = tanggal
 * transaksi pertama, kolom channel = gudang uji saja.
 */
function eventUji(event, uji, rows) {
  const tanggal = rows
    .map((r) => r.tanggal)
    .filter(Boolean)
    .sort();
  return {
    ...event,
    dari: tanggal[0] || event.dari,
    sampai: tanggal[tanggal.length - 1] || event.dari,
    warehouse: [uji.warehouse],
  };
}

function createPostgresSource(cfg, event, deps = {}, uji = null) {
  // Vercel Function mengirim Pool yang di-import statis supaya pg ikut dibundel.
  const Pool = deps.Pool || require("pg").Pool;
  // DATABASE_URL didahulukan; selain itu variabel terpisah, supaya password
  // yang penuh tanda baca bisa ditulis apa adanya tanpa di-URL-encode.
  const conn = cfg.url
    ? { connectionString: cfg.url }
    : {
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database,
      };
  const pool = new Pool({
    ...conn,
    ssl: cfg.ssl
      ? { rejectUnauthorized: cfg.sslRejectUnauthorized }
      : undefined,
    max: deps.maxConnections || 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: 20000,
  });
  // Klien menganggur yang putus tidak boleh mematikan server.
  pool.on("error", (e) =>
    console.error("[postgres] idle client error:", e.message),
  );

  // PG_QUERY mengganti seluruh query (tanpa parameter). Kolom keluarannya harus
  // sama dengan query bawaan.
  const custom = (cfg.query || "").trim();
  const modeUji = !custom && uji;
  let sql = custom || buildQuery(cfg, event);
  let params = custom ? [] : [event.warehouse, event.dari, event.sampai];
  if (modeUji) {
    sql = buildQueryUji(cfg, event);
    params = [uji.warehouse, uji.limit];
  }

  return {
    name: "postgres",
    async fetch() {
      const res = await pool.query(sql, params);
      if (!modeUji) return { rows: res.rows, event };
      return { rows: res.rows, event: eventUji(event, uji, res.rows), uji };
    },
    close: () => pool.end(),
  };
}

module.exports = { createPostgresSource, buildQuery, buildQueryUji };
