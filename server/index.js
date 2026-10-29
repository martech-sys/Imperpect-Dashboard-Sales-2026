"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createApp } = require("./app");

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  // Tidak ada .env: pakai environment apa adanya.
}

const app = createApp(process.env);
const BUILD = path.join(__dirname, "..", "build");

const TIPE = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

/** Alamat bersih (/transactions) dipetakan ke berkas build, sama seperti cleanUrls di Vercel. */
function berkasUntuk(pathname) {
  const bersih = pathname === "/" ? "/index.html" : pathname;
  const kandidat = path.extname(bersih) ? bersih : `${bersih}.html`;
  const penuh = path.normalize(path.join(BUILD, kandidat));
  // Tidak ada yang bisa diminta di luar folder build.
  return penuh.startsWith(BUILD + path.sep) ? penuh : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) return app.handle(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    return res.end("Method not allowed");
  }
  // Alamat lama berakhiran .html dialihkan ke bentuk bersihnya.
  if (url.pathname.endsWith(".html")) {
    const tujuan =
      url.pathname === "/index.html" ? "/" : url.pathname.slice(0, -5);
    res.writeHead(301, { Location: tujuan + url.search });
    return res.end();
  }
  const berkas = berkasUntuk(url.pathname);
  if (!berkas) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  fs.readFile(berkas, (err, isi) => {
    if (err) {
      const belumBuild = err.code === "ENOENT" && !fs.existsSync(BUILD);
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(
        belumBuild
          ? "Frontend belum dibangun. Jalankan: npm run build"
          : "Not found",
      );
    }
    const ext = path.extname(berkas);
    res.writeHead(200, {
      "Content-Type": TIPE[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : isi);
  });
});

server.listen(app.config ? app.config.port : 3000, () => {
  const c = app.config;
  if (!c)
    return console.log(
      "Server berjalan, tetapi konfigurasi tidak valid (lihat log di atas).",
    );
  console.log(
    `Dashboard ${c.event.nama} di http://localhost:${c.port} — sumber: ${c.demo ? "data contoh (mode demo)" : "Postgres"}, ` +
      `cache ${c.cacheSeconds} dtk, login ${c.auth.password ? "aktif" : "tidak aktif"}`,
  );
});

function shutdown() {
  server.close();
  Promise.resolve(app.close()).finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
