"use strict";

const { parseSesi, parseBuffer, pasangPotongan } = require("./sesi");

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
 * Mode uji: dashboard membaca sebagian kecil data gudang lain (mis. event
 * 2025) supaya tampilannya bisa dicek dengan data asli. Mati bawaannya —
 * dashboard membaca gudang & tanggal event 2026. Nyalakan dengan mengisi
 * UJI_WAREHOUSE (mis. "MAIN STAGE IMPERFECT SALE 2025").
 */
const UJI_WAREHOUSE_BAWAAN = "";
const UJI_MATI = /^(off|false|0|-)?$/i;

/**
 * Data mulai dibaca dari tanggal ini, walau Day 1 tetap EVENT_DARI: tanggal
 * sebelum EVENT_DARI tampil sebagai "Day 0" (seluruhnya "Di luar sesi"),
 * sehingga hari & sesi event tidak bergeser. Kosong = data hanya dari
 * EVENT_DARI. Dipakai sementara untuk mengecek transaksi uji (mis. isi
 * EVENT_DATA_DARI=2026-10-29 di Vercel).
 */
const DATA_DARI_BAWAAN = "";

/**
 * Buffer potongan sesi per hari (menit): batas antar sesi digeser ke belakang.
 * Day 2: Sesi 1 menampung 09.00–11.14, Sesi 2 11.15–13.14, dst. Ganti lewat
 * EVENT_SESI_BUFFER (mis. "2:15, 3:15"); kosongkan untuk tanpa buffer.
 */
const BUFFER_SESI_BAWAAN = "2:15";

/** Kolom yang menjadi kolom "channel" di tabel pivot. */
const KOLOM_CHANNEL = new Set(["warehouse", "channel"]);

function loadConfig(env) {
  const dari = env.EVENT_DARI || "2026-10-30";
  const sampai = env.EVENT_SAMPAI || "2026-11-01";
  if (!TANGGAL.test(dari) || !TANGGAL.test(sampai)) {
    throw new Error("EVENT_DARI / EVENT_SAMPAI harus berformat YYYY-MM-DD");
  }
  if (sampai < dari) throw new Error("EVENT_SAMPAI lebih awal dari EVENT_DARI");
  const dataDari =
    (env.EVENT_DATA_DARI === undefined
      ? DATA_DARI_BAWAAN
      : env.EVENT_DATA_DARI
    ).trim() || dari;
  if (!TANGGAL.test(dataDari) || dataDari > dari) {
    throw new Error(
      "EVENT_DATA_DARI harus berformat YYYY-MM-DD dan tidak sesudah EVENT_DARI",
    );
  }

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
      dataDari,
      warehouse: daftar(
        env.EVENT_WAREHOUSE ||
          "MAIN IMPERFECT WAREHOUS 2026, TEBUS MURAH IMPERFECT 2026",
      ),
      kolomChannel,
      sesi: pasangPotongan(
        parseSesi(env.EVENT_SESI),
        parseBuffer(
          env.EVENT_SESI_BUFFER === undefined
            ? BUFFER_SESI_BAWAAN
            : env.EVENT_SESI_BUFFER,
        ),
      ),
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
      // Sheet yang namanya sama dengan salah satu nama ini (huruf besar/kecil,
      // spasi & tanda baca diabaikan) tidak dibaca, mis. Sheet "Internal" di
      // folder yang sama. Kosong = baca semua.
      exclude: daftar(
        env.DRIVE_EXCLUDE === undefined ? "internal" : env.DRIVE_EXCLUDE,
      ),
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
