"use strict";

/**
 * Entrypoint Vercel. Seluruh /api/... diarahkan ke sini lewat `rewrites` di
 * vercel.json; URL aslinya tetap utuh, jadi router di server/app.js sama
 * dengan yang dipakai server Node. Berkas statis (HTML, bundle.js, style.css)
 * dilayani CDN dari folder build/.
 */

const { Pool } = require("pg");
const { waitUntil } = require("@vercel/functions");
const { createApp } = require("../server/app");

// Satu query per pembacaan, jadi tiap instance cukup memegang satu koneksi.
// waitUntil menjaga pembacaan data di belakang (stale-while-revalidate) tetap
// berjalan sesudah jawaban dikirim.
const app = createApp(process.env, { Pool, maxConnections: 1, waitUntil });

module.exports = (req, res) => app.handle(req, res);
