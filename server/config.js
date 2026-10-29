"use strict";

const { parseSesi } = require("./sesi");

/**
 * Satu tempat yang menerjemahkan environment variable menjadi konfigurasi,
 * dipakai bersama server Node (server/index.js) dan Vercel Function
 * (api/index.js). Cara membaca warehouse mengikuti IMPERPECT-SALES-2026:
 * query langsung ke `laporan_penjualan`, paling sering sekali per
 * CACHE_SECONDS, berapa pun yang membuka dashboard.
 */

const flag = (v, d) =>
  v == null || v === "" ? d : /^(1|true|yes|on)$/i.test(v);

const daftar = (v) =>
  String(v || "")
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Mode uji: sebelum event 2026 punya transaksi, dashboard membaca sebagian
 * kecil data gudang event lama supaya tampilannya bisa dicek dengan data asli.
 * Aktif sampai UJI_WAREHOUSE diisi `off` (atau bawaan ini dikosongkan).
 */
const UJI_WAREHOUSE_BAWAAN = "MAIN STAGE IMPERFECT SALE 2025";
const UJI_MATI = /^(off|false|0|-)?$/i;

/** Kolom yang menjadi kolom "channel" di tabel pivot. */
const KOLOM_CHANNEL = new Set(["warehouse", "channel"]);

function loadConfig(env) {
  const dari = env.EVENT_DARI || "2026-10-30";
  const sampai = env.EVENT_SAMPAI || "2026-11-01";
  if (!TANGGAL.test(dari) || !TANGGAL.test(sampai)) {
    throw new Error("EVENT_DARI / EVENT_SAMPAI harus berformat YYYY-MM-DD");
  }
  if (sampai < dari) throw new Error("EVENT_SAMPAI lebih awal dari EVENT_DARI");

  const kolomChannel = (env.KOLOM_CHANNEL || "warehouse").trim().toLowerCase();
  if (!KOLOM_CHANNEL.has(kolomChannel)) {
    throw new Error("KOLOM_CHANNEL hanya boleh warehouse atau channel");
  }
  const schema = (env.DB_SCHEMA || "").trim();
  if (schema && !IDENTIFIER.test(schema))
    throw new Error("DB_SCHEMA bukan nama schema yang sah");

  return {
    port: parseInt(env.PORT || "3000", 10),
    cacheSeconds: Math.max(5, parseInt(env.CACHE_SECONDS || "60", 10) || 60),
    event: {
      nama: env.EVENT_NAMA || "Imperfect Sale 2026",
      dari,
      sampai,
      warehouse: daftar(
        env.EVENT_WAREHOUSE ||
          "MAIN IMPERFECT WAREHOUS 2026, TEBUS MURAH IMPERFECT 2026",
      ),
      kolomChannel,
      sesi: parseSesi(env.EVENT_SESI),
    },
    pg: {
      url: env.DATABASE_URL,
      host: env.DATABASE_HOST,
      port: parseInt(env.DATABASE_PORT || "5432", 10),
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      database: env.DATABASE_NAME,
      schema,
      query: env.PG_QUERY,
      ssl: flag(env.PG_SSL, false),
      sslRejectUnauthorized: flag(env.PG_SSL_REJECT_UNAUTHORIZED, true),
    },
    uji: bacaUji(env),
    // Brand eksternal: satu Sheet per brand di satu folder Drive (cara papan
    // TV IMPERPECT-SALES-2026). Kosong = data contoh di tab Ringkasan Eksternal.
    drive: {
      folder: (env.DRIVE_FOLDER || "").trim(),
      json: env.GOOGLE_SERVICE_ACCOUNT_JSON,
      email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: env.GOOGLE_PRIVATE_KEY,
      maxRows: parseInt(env.DRIVE_MAX_ROWS || "5000", 10),
    },
    auth: {
      password: env.DASHBOARD_PASSWORD || "",
      secret: env.SESSION_SECRET || "",
    },
    // Mode demo hanya dipakai bila memang diminta atau database belum diisi
    // sama sekali; database yang gagal dibaca TIDAK diganti data contoh.
    demo:
      flag(env.DEMO_MODE, false) || !(env.DATABASE_URL || env.DATABASE_HOST),
  };
}

function bacaUji(env) {
  const warehouse = (
    env.UJI_WAREHOUSE === undefined ? UJI_WAREHOUSE_BAWAAN : env.UJI_WAREHOUSE
  ).trim();
  if (UJI_MATI.test(warehouse)) return null;
  const limit = parseInt(env.UJI_LIMIT || "20", 10);
  return {
    warehouse,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 5000) : 20,
  };
}

module.exports = { loadConfig };
