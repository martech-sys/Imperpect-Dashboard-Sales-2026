"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

/**
 * Data penjualan yang dikunci: event sudah selesai, jadi dashboard tidak perlu
 * terus membaca database. Hasil query terakhir (baris laporan_penjualan +
 * transaksi manual) disimpan sebagai file gzip di repo:
 *
 *   data/snapshot-penjualan.json.gz
 *
 * Selama file itu ada, dashboard memakai isinya dan TIDAK membuka koneksi ke
 * database penjualan (kecuali env DATA_LIVE=1). File dibuat lewat
 * /api/kunci-data?ya=1 oleh admin dashboard stok: server membaca database
 * sekali lalu meng-commit file itu ke GitHub, dan deploy berikutnya otomatis
 * terkunci.
 *
 * Isi baris sama dengan hasil query (tanpa nama & nomor HP pelanggan — query
 * memang tidak mengambilnya).
 */

const FILE_BAWAAN = path.join(
  __dirname,
  "..",
  "data",
  "snapshot-penjualan.json.gz",
);
const PATH_REPO = "data/snapshot-penjualan.json.gz";

function buatSnapshot(rows, info = {}) {
  const isi = {
    versi: 1,
    diambil: new Date().toISOString(),
    jumlah: rows.length,
    ...info,
    rows,
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(isi)), { level: 9 });
}

function bacaSnapshot(file = FILE_BAWAAN) {
  if (!fs.existsSync(file)) return null;
  const isi = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
  if (!Array.isArray(isi.rows)) throw new Error("File snapshot rusak");
  return isi;
}

/** Sumber data dari file snapshot (bentuknya sama dengan sumber postgres). */
function createSnapshotSource(snap) {
  return {
    name: "snapshot",
    diambil: snap.diambil,
    async fetch() {
      return snap.rows;
    },
    close: async () => {},
  };
}

/** Commit file snapshot ke repo GitHub (Contents API). */
async function simpanKeGithub(gh, buffer, pesan, ambil = globalThis.fetch) {
  const url = `https://api.github.com/repos/${gh.repo}/contents/${PATH_REPO}`;
  const headers = {
    Authorization: `Bearer ${gh.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "imperfect-sale-dashboard",
  };
  const cek = await ambil(
    `${url}?ref=${encodeURIComponent(gh.branch || "main")}`,
    { headers },
  );
  const sha = cek.ok ? (await cek.json()).sha : null;
  const res = await ambil(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: pesan,
      content: buffer.toString("base64"),
      branch: gh.branch || "main",
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    let alasan = "";
    try {
      alasan = (await res.json()).message || "";
    } catch {
      // tanpa body JSON
    }
    const err = new Error(
      `Gagal menyimpan snapshot ke GitHub (HTTP ${res.status}${alasan ? `: ${alasan}` : ""}).`,
    );
    err.status = 502;
    throw err;
  }
  return (await res.json()).commit?.html_url || null;
}

module.exports = {
  FILE_BAWAAN,
  PATH_REPO,
  buatSnapshot,
  bacaSnapshot,
  createSnapshotSource,
  simpanKeGithub,
};
