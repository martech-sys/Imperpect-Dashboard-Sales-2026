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

function buildQuery(cfg, event) {
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
  FROM ${tabel}
 WHERE warehouse = ANY($1::text[])
   AND tanggal >= $2::date
   AND tanggal < ($3::date + 1)`;
}

function createPostgresSource(cfg, event, deps = {}) {
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
  const sql = custom || buildQuery(cfg, event);
  const params = custom ? [] : [event.warehouse, event.dari, event.sampai];

  return {
    name: "postgres",
    async fetch() {
      const res = await pool.query(sql, params);
      return res.rows;
    },
    close: () => pool.end(),
  };
}

module.exports = { createPostgresSource, buildQuery };
