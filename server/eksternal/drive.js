"use strict";

/**
 * Sheet brand eksternal di satu folder Google Drive, dibaca dengan akun
 * layanan — cara yang sama dengan sumber `drive` papan TV IMPERPECT-SALES-2026
 * (server/sources/drive.js di repo itu). Hanya membaca: token meminta
 * drive.readonly saja.
 *
 * - Folder di-share sekali ke email akun layanan (Viewer); tiap brand hanya
 *   memegang file-nya sendiri, jadi brand tidak melihat omzet brand lain.
 * - Tiap pembacaan: 1× daftar isi folder, lalu hanya file yang berubah sejak
 *   pembacaan terakhir (modifiedTime) yang diekspor ulang sebagai CSV tab
 *   pertama. Keduanya lewat Drive API — Sheets API hanya 60 baca/menit.
 * - File yang gagal dibaca tetap memakai isi terakhirnya dan dilaporkan per
 *   brand. Nama file = nama brand.
 * - File yang namanya persis salah satu nama di `cfg.exclude` (bawaan
 *   "internal", huruf besar/kecil sama) dilewati: bukan Sheet brand eksternal.
 */

const crypto = require("node:crypto");
const { parseCSV, rowsToRecords } = require("./sheet");

const SCOPES = "https://www.googleapis.com/auth/drive.readonly";
const SPREADSHEET = "application/vnd.google-apps.spreadsheet";

function createDriveSource(cfg) {
  const key = serviceAccount(cfg);
  const folderId = folderIdOf(cfg.folder);
  if (!folderId)
    throw new Error("Isi DRIVE_FOLDER (link atau ID folder Google Drive)");
  const maxRows = Math.max(2, cfg.maxRows || 5000);
  const concurrency = Math.max(1, cfg.concurrency || 5);
  const exclude = new Set((cfg.exclude || []).map((k) => k.toLowerCase()));
  const dilewati = (nama) =>
    exclude.has(
      String(nama || "")
        .trim()
        .toLowerCase(),
    );
  const urls = {
    token: "https://oauth2.googleapis.com/token",
    drive: "https://www.googleapis.com/drive/v3",
    ...cfg.urls,
  };
  const files = new Map(); // id file → { name, mod, records, error }
  let token = null;
  let tokenExp = 0;
  let getting = null;

  async function accessToken() {
    if (token && Date.now() < tokenExp - 60e3) return token;
    getting =
      getting ||
      (async () => {
        const now = Math.floor(Date.now() / 1000);
        const jwt = signJwt(
          {
            iss: key.email,
            scope: SCOPES,
            aud: urls.token,
            iat: now,
            exp: now + 3600,
          },
          key.privateKey,
        );
        const res = await fetch(urls.token, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: jwt,
          }),
          signal: AbortSignal.timeout(15000),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.access_token) {
          throw new Error(
            `Login akun layanan gagal: ${body.error_description || body.error || `HTTP ${res.status}`}`,
          );
        }
        token = body.access_token;
        tokenExp = Date.now() + (body.expires_in || 3600) * 1000;
        return token;
      })().finally(() => {
        getting = null;
      });
    return getting;
  }

  async function get(url, asText) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return asText ? res.text() : res.json();
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `HTTP ${res.status}${body.error && body.error.message ? `: ${body.error.message}` : ""}`,
    );
  }

  async function listFolder() {
    const out = [];
    let page = "";
    do {
      const q = new URLSearchParams({
        q: `'${folderId}' in parents and mimeType='${SPREADSHEET}' and trashed=false`,
        fields: "nextPageToken,files(id,name,modifiedTime)",
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (page) q.set("pageToken", page);
      let r;
      try {
        r = await get(`${urls.drive}/files?${q}`);
      } catch (e) {
        throw new Error(
          `Folder Drive tidak bisa dibaca (${e.message}). Share folder ke ${key.email} sebagai Viewer`,
        );
      }
      out.push(...(r.files || []));
      page = r.nextPageToken || "";
    } while (page);
    return out;
  }

  async function readFile(f) {
    const csv = await get(
      `${urls.drive}/files/${encodeURIComponent(f.id)}/export?mimeType=text%2Fcsv`,
      true,
    );
    return rowsToRecords(parseCSV(csv).slice(0, maxRows));
  }

  return {
    name: "drive",
    /** → [{ brand, diubah, records, error }], satu per file di folder. */
    async fetch() {
      const listed = (await listFolder()).filter((f) => !dilewati(f.name));
      const ids = new Set(listed.map((f) => f.id));
      for (const id of files.keys()) if (!ids.has(id)) files.delete(id);
      const todo = listed.filter((f) => {
        const c = files.get(f.id);
        if (c) c.name = f.name;
        return !c || c.mod !== f.modifiedTime || c.error;
      });
      let i = 0;
      async function worker() {
        while (i < todo.length) {
          const f = todo[i];
          i += 1;
          const c = files.get(f.id) || { name: f.name, records: [] };
          try {
            // eslint-disable-next-line no-await-in-loop
            c.records = await readFile(f);
            c.mod = f.modifiedTime;
            c.error = null;
          } catch (e) {
            c.error = e.message; // isi terakhir brand ini tetap dipakai
          }
          files.set(f.id, c);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(concurrency, todo.length) }, worker),
      );
      return Array.from(files.values(), (c) => ({
        brand: c.name,
        diubah: c.mod || null,
        records: c.records,
        error: c.error || null,
      }));
    },
  };
}

/** GOOGLE_SERVICE_ACCOUNT_JSON (isi file key) atau EMAIL + PRIVATE_KEY. */
function serviceAccount(cfg) {
  let { email } = cfg;
  let pem = cfg.privateKey;
  if (cfg.json) {
    let j;
    try {
      j = JSON.parse(cfg.json);
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON yang valid");
    }
    email = j.client_email;
    pem = j.private_key;
  }
  if (!email || !pem) {
    throw new Error(
      "Isi GOOGLE_SERVICE_ACCOUNT_JSON (atau GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY)",
    );
  }
  // kunci yang ditempel ke env satu baris datang dengan \n literal
  pem = String(pem).replace(/\\n/g, "\n");
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(pem);
  } catch {
    throw new Error("Kunci privat akun layanan tidak valid");
  }
  return { email, privateKey };
}

function signJwt(claims, privateKey) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${enc({ alg: "RS256", typ: "JWT" })}.${enc(claims)}`;
  return `${head}.${crypto.sign("RSA-SHA256", Buffer.from(head), privateKey).toString("base64url")}`;
}

function folderIdOf(s) {
  const v = String(s || "").trim();
  const m =
    v.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
    v.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(v) ? v : "";
}

module.exports = { createDriveSource, folderIdOf };
