"use strict";

const { loadConfig } = require("./config");
const { createAuth } = require("./auth");
const { createStore } = require("./store");
const { createPostgresSource } = require("./source-postgres");
const { createDemoSource } = require("./demo-data");
const report = require("./report");
const eksternal = require("./eksternal");
const { ringkasanAll } = require("./ringkasan");
const { compare } = require("./compare");
const { laporanTarget } = require("./target");
const stok = require("./stock");
const { createStockUsers } = require("./stock-users");

/**
 * Seluruh endpoint /api/*, dipakai bersama server Node (server/index.js) dan
 * Vercel Function (api/index.js).
 *
 *   GET  /api/app               info event, mode data, status login
 *   GET  /api/pivot             tabel Sesi × Channel + KPI
 *   GET  /api/transactions      rincian per baris produk (paginasi)
 *   GET  /api/transactions.csv  ekspor rincian
 *   GET  /api/compare           2026 vs Imperfect Sale 2025 per hari × sesi
 *   GET  /api/target            target 2026 per sesi & brand vs aktual
 *   GET  /api/health            kesegaran data, tanpa isi transaksi
 *   POST /api/auth/login        { password }
 *   POST /api/auth/logout
 *
 * Dashboard stok (/stock), dengan login sendiri:
 *   GET  /api/stock/app         status login stok
 *   POST /api/stock/login       { username, password }
 *   POST /api/stock/logout
 *   GET  /api/stock             kode tag: stock & ATP (+ KPI, filter)
 *   GET  /api/stock/tag         metrik per SKU satu kode tag
 *   GET  /api/stock.csv         ekspor per SKU
 */

function json(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // Jawaban bergantung pada cookie sesi, jadi tidak boleh di-cache CDN.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

async function bacaBody(req, maks = 10000) {
  // Runtime Vercel sudah mengurai body JSON; server Node biasa belum.
  if (req.body !== undefined) {
    return typeof req.body === "string"
      ? JSON.parse(req.body || "{}")
      : req.body || {};
  }
  let teks = "";
  for await (const potong of req) {
    teks += potong;
    if (teks.length > maks) throw new Error("Body terlalu besar");
  }
  return teks ? JSON.parse(teks) : {};
}

function createApp(env, deps = {}) {
  let config;
  try {
    config = loadConfig(env);
  } catch (err) {
    // Kesalahan konfigurasi dilaporkan apa adanya di setiap endpoint, bukan
    // membuat fungsi mati dengan halaman error generik dari hosting.
    console.error("[config]", err.message);
    return {
      config: null,
      handle: (req, res) =>
        json(res, 500, {
          error: "config_error",
          message: `Konfigurasi tidak valid: ${err.message}`,
        }),
      close: async () => {},
    };
  }

  const { event } = config;
  const source = config.demo
    ? createDemoSource(event)
    : createPostgresSource(config.pg, event, deps, config.uji);
  const store = createStore(source, event, {
    cacheSeconds: config.cacheSeconds,
    waitUntil: deps.waitUntil,
  });
  const auth = createAuth(config.auth);
  const stockUsers = createStockUsers(
    {
      admin: config.stock.auth,
      secret: config.stock.auth.secret,
      github: config.stock.github,
    },
    deps,
  );
  const stockStore = createStore(
    config.demo
      ? stok.createDemoStockSource()
      : stok.createStockSource({ ...config.stock, pg: config.pg }, deps),
    event,
    {
      cacheSeconds: config.stock.cacheSeconds,
      waitUntil: deps.waitUntil,
      olah: (raw) => ({ rows: stok.siapkanStok(raw), dibuang: 0 }),
    },
  );
  const brandEksternal = eksternal.createEksternal(config.drive, {
    cacheSeconds: config.cacheSeconds,
    waitUntil: deps.waitUntil,
  });
  /**
   * Tanpa gerbang password, jawaban data sama untuk semua orang, jadi boleh
   * disimpan CDN Vercel: pengunjung berikutnya (dan instance yang baru
   * menyala) dilayani CDN tanpa menyentuh function. Dengan password,
   * jawaban bergantung pada cookie sesi dan tidak boleh di-cache CDN.
   * Deploy baru mengosongkan cache CDN.
   *
   * Jendelanya sengaja pendek (15 detik segar + 60 detik basi) supaya dua tab
   * yang alamatnya di-cache terpisah tidak berselisih lebih dari ±1 menit.
   */
  const cdnBawaan = auth.aktif
    ? {}
    : {
        "Vercel-CDN-Cache-Control": "max-age=15, stale-while-revalidate=60",
      };

  /** Isi folder brand eksternal, atau jawaban galat bila belum pernah terbaca. */
  async function dataEksternal(res, segar) {
    const d = await brandEksternal.get({ segar });
    if (!d.files) {
      json(res, 503, {
        error: "data_unavailable",
        message: `Sheet brand eksternal belum bisa dibaca: ${d.kesegaran.error}`,
        kesegaran: d.kesegaran,
      });
      return null;
    }
    return d;
  }

  /** Data penjualan, atau jawaban galat bila belum pernah berhasil dibaca. */
  async function data(res, segar) {
    const d = await store.get({ segar });
    if (!d.rows) {
      json(res, 503, {
        error: "data_unavailable",
        message: `Data penjualan belum bisa dibaca dari ${d.kesegaran.sumber}: ${d.kesegaran.error}`,
        kesegaran: d.kesegaran,
      });
      return null;
    }
    return d;
  }

  const ipDari = (req) =>
    String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
      .split(",")[0]
      .trim();
  const koneksiAman = (req) =>
    req.headers["x-forwarded-proto"] === "https" ||
    Boolean(req.socket?.encrypted);

  async function handleStock(req, res, path, queryAwal, segar) {
    let query = queryAwal;
    const user = await stockUsers.masuk(req.headers.cookie);
    if (path === "/api/stock/app" && req.method === "GET") {
      return json(res, 200, {
        mode: config.demo ? "demo" : "postgres",
        tabel: config.stock.tabel,
        auth: { aktif: stockUsers.aktif, masuk: Boolean(user), user },
      });
    }
    if (!stockUsers.aktif && path !== "/api/stock/logout") {
      // Tanpa password di env, data stok tidak dibuka untuk siapa pun.
      return json(res, 503, {
        error: "auth_not_configured",
        message:
          "Login dashboard stok belum diaktifkan: isi STOCK_PASSWORD di environment variable Vercel.",
      });
    }
    if (path === "/api/stock/login" && req.method === "POST") {
      const body = await bacaBody(req).catch(() => ({}));
      const username = typeof body.username === "string" ? body.username : "";
      const gagal = await stockUsers.cobaMasuk(
        ipDari(req),
        username,
        typeof body.password === "string" ? body.password : "",
      );
      if (gagal)
        return json(res, 401, { error: "login_failed", message: gagal });
      return json(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie": await stockUsers.cookieMasuk(
            username,
            koneksiAman(req),
          ),
        },
      );
    }
    if (path === "/api/stock/logout" && req.method === "POST") {
      return json(
        res,
        200,
        { ok: true },
        { "Set-Cookie": stockUsers.cookieKeluar() },
      );
    }
    if (!user) {
      return json(res, 401, {
        error: "unauthorized",
        message: "Silakan masuk ke dashboard stok terlebih dahulu.",
      });
    }

    // ---- Kelola user: khusus admin ----
    if (path === "/api/stock/users") {
      if (user.role !== "admin")
        return json(res, 403, {
          error: "forbidden",
          message: "Hanya admin yang bisa mengelola user.",
        });
      try {
        if (req.method === "POST") {
          const body = await bacaBody(req).catch(() => ({}));
          const aksi = body.aksi;
          if (aksi === "tambah") await stockUsers.tambah(body, user.username);
          else if (aksi === "hapus")
            await stockUsers.hapus(body.username, user.username);
          else if (aksi === "password")
            await stockUsers.gantiPassword(
              body.username,
              body.password,
              user.username,
            );
          else if (aksi === "role")
            await stockUsers.gantiRole(body.username, body.role, user.username);
          else
            return json(res, 400, {
              error: "bad_request",
              message: "Aksi tidak dikenal.",
            });
        } else if (req.method !== "GET") {
          return json(res, 405, {
            error: "method_not_allowed",
            message: "Method tidak didukung.",
          });
        }
        return json(res, 200, await stockUsers.daftar());
      } catch (e) {
        return json(res, e.status || 500, {
          error: "user_error",
          message: e.message,
        });
      }
    }

    // Export kode tag terpilih memakai POST (daftar kode tag bisa panjang).
    const exportPost = path === "/api/stock.csv" && req.method === "POST";
    if (req.method !== "GET" && !exportPost)
      return json(res, 405, {
        error: "method_not_allowed",
        message: "Method tidak didukung.",
      });
    if (exportPost) {
      const body = await bacaBody(req, 1_000_000).catch(() => null);
      if (!body || typeof body !== "object")
        return json(res, 400, {
          error: "bad_request",
          message: "Isi permintaan export tidak terbaca.",
        });
      query = { ...query, ...body };
    }

    const d = await stockStore.get({ segar });
    if (!d.rows) {
      return json(res, 503, {
        error: "data_unavailable",
        message: `Data stok belum bisa dibaca dari ${config.stock.tabel}: ${d.kesegaran.error}`,
        kesegaran: d.kesegaran,
      });
    }
    if (path === "/api/stock") {
      const { semua, ...hasil } = stok.daftarTag(d.rows, query);
      return json(res, 200, {
        ...hasil,
        options: stok.opsiStok(d.rows),
        kesegaran: d.kesegaran,
      });
    }
    if (path === "/api/stock/tag") {
      const detail = stok.detailTag(d.rows, query.kode_tag || "", query);
      if (!detail)
        return json(res, 404, {
          error: "not_found",
          message: `Kode tag "${query.kode_tag || ""}" tidak ditemukan.`,
        });
      return json(res, 200, { ...detail, kesegaran: d.kesegaran });
    }
    if (path === "/api/stock.csv") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="stok-atp-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      return res.end(stok.stokCsv(d.rows, query));
    }
    return json(res, 404, {
      error: "not_found",
      message: "Endpoint tidak ditemukan.",
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/\/+$/, "");
    const query = Object.fromEntries(url.searchParams.entries());
    // Tombol Refresh mengirim ?segar=1: lewati cache server dan CDN.
    const segar = query.segar === "1";
    const cdn = segar ? {} : cdnBawaan;
    const sudahMasuk = auth.masuk(req.headers.cookie);

    try {
      if (path === "/api/app" && req.method === "GET") {
        return json(res, 200, {
          event: {
            nama: event.nama,
            dari: event.dari,
            sampai: event.sampai,
            warehouse: event.warehouse,
            kolomChannel: event.kolomChannel,
          },
          mode: config.demo ? "demo" : "postgres",
          uji: config.demo || config.pg.query ? null : config.uji,
          refreshSeconds: Math.max(30, config.cacheSeconds),
          auth: { aktif: auth.aktif, masuk: sudahMasuk },
        });
      }

      // ---- Dashboard stok: login sendiri, tidak memakai gerbang penjualan ----
      if (path.startsWith("/api/stock")) {
        // Filter checklist: parameter yang diulang dibaca semua nilainya.
        const multi = [
          "warehouse",
          "brand",
          "kategori",
          "kelas",
          "status",
          "atp",
        ];
        const qStok = { ...query };
        multi.forEach((k) => {
          if (url.searchParams.has(k)) qStok[k] = url.searchParams.getAll(k);
        });
        return await handleStock(req, res, path, qStok, segar);
      }

      if (path === "/api/auth/login" && req.method === "POST") {
        if (!auth.aktif)
          return json(res, 400, {
            error: "auth_off",
            message: "Login tidak diaktifkan.",
          });
        const body = await bacaBody(req).catch(() => ({}));
        const ip = String(
          req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
        )
          .split(",")[0]
          .trim();
        const gagal = auth.cobaMasuk(
          ip,
          typeof body.password === "string" ? body.password : "",
        );
        if (gagal)
          return json(res, 401, { error: "login_failed", message: gagal });
        const aman =
          req.headers["x-forwarded-proto"] === "https" ||
          Boolean(req.socket?.encrypted);
        return json(
          res,
          200,
          { ok: true },
          { "Set-Cookie": auth.cookieMasuk(aman) },
        );
      }

      if (path === "/api/auth/logout" && req.method === "POST") {
        return json(
          res,
          200,
          { ok: true },
          { "Set-Cookie": auth.cookieKeluar() },
        );
      }

      if (path === "/api/health" && req.method === "GET") {
        const d = await store.get();
        return json(res, d.rows ? 200 : 503, {
          ok: Boolean(d.rows),
          mode: config.demo ? "demo" : "postgres",
          baris: d.rows ? d.rows.length : 0,
          dibuang: d.dibuang,
          kesegaran: d.kesegaran,
          // Nama variabel saja, tidak pernah nilainya.
          env: Object.fromEntries(
            [
              "DATABASE_URL",
              "DATABASE_HOST",
              "DATABASE_USER",
              "DATABASE_PASSWORD",
              "DATABASE_NAME",
              "PG_QUERY",
              "EVENT_WAREHOUSE",
              "EVENT_SESI",
              "DASHBOARD_PASSWORD",
              "DRIVE_FOLDER",
              "GOOGLE_SERVICE_ACCOUNT_JSON",
            ].map((k) => [k, env[k] ? "terisi" : "kosong"]),
          ),
        });
      }

      // Endpoint data: tertutup bila gerbang password aktif.
      if (auth.aktif && !sudahMasuk && path.startsWith("/api/")) {
        return json(res, 401, {
          error: "unauthorized",
          message: "Silakan masuk terlebih dahulu.",
        });
      }
      if (req.method !== "GET")
        return json(res, 405, {
          error: "method_not_allowed",
          message: "Method tidak didukung.",
        });

      if (path === "/api/ringkasan") {
        // Kedua sumber dibaca bersamaan; yang gagal tidak menahan yang lain.
        const [dI, dE] = await Promise.all([
          store.get({ segar }),
          brandEksternal.get({ segar }),
        ]);
        if (!dI.rows && !dE.files) {
          return json(res, 503, {
            error: "data_unavailable",
            message: `Belum ada sumber yang terbaca. Internal: ${dI.kesegaran.error}. Eksternal: ${dE.kesegaran.error}.`,
          });
        }
        return json(
          res,
          200,
          {
            ...ringkasanAll({
              internalRows: dI.rows,
              eksternalFiles: dE.files,
            }),
            kesegaran: { internal: dI.kesegaran, eksternal: dE.kesegaran },
            galat: {
              internal: dI.rows ? null : dI.kesegaran.error,
              eksternal: dE.files ? null : dE.kesegaran.error,
            },
          },
          cdn,
        );
      }

      if (path === "/api/eksternal") {
        const d = await dataEksternal(res, segar);
        if (!d) return undefined;
        return json(
          res,
          200,
          {
            ...eksternal.ringkasan(d.files),
            kesegaran: d.kesegaran,
          },
          cdn,
        );
      }

      if (path === "/api/eksternal/brand") {
        const d = await dataEksternal(res, segar);
        if (!d) return undefined;
        const detail = eksternal.detailBrand(d.files, query.brand || "");
        if (!detail) {
          return json(res, 404, {
            error: "not_found",
            message: `Brand "${query.brand || ""}" tidak ada di folder Drive.`,
          });
        }
        return json(res, 200, { ...detail, kesegaran: d.kesegaran }, cdn);
      }

      if (path === "/api/pivot") {
        const d = await data(res, segar);
        if (!d) return undefined;
        return json(
          res,
          200,
          {
            ...report.pivot(d.rows, d.event, query),
            options: report.opsiFilter(d.rows, d.event),
            kesegaran: d.kesegaran,
          },
          cdn,
        );
      }

      if (path === "/api/compare") {
        const d = await data(res, segar);
        if (!d) return undefined;
        return json(
          res,
          200,
          { ...compare(d.rows, d.event), kesegaran: d.kesegaran },
          cdn,
        );
      }

      if (path === "/api/target") {
        const d = await data(res, segar);
        if (!d) return undefined;
        return json(
          res,
          200,
          { ...laporanTarget(d.rows, d.event), kesegaran: d.kesegaran },
          cdn,
        );
      }

      if (path === "/api/transactions") {
        const d = await data(res, segar);
        if (!d) return undefined;
        return json(
          res,
          200,
          {
            ...report.transactions(d.rows, query),
            options: report.opsiFilter(d.rows, d.event),
            kesegaran: d.kesegaran,
          },
          cdn,
        );
      }

      if (path === "/api/transactions.csv") {
        const d = await data(res, segar);
        if (!d) return undefined;
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        Object.entries(cdn).forEach(([k, v]) => res.setHeader(k, v));
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="rincian-imperfect-sale_${d.event.dari}_${d.event.sampai}.csv"`,
        );
        return res.end(report.transactionsCsv(d.rows, query));
      }

      return json(res, 404, {
        error: "not_found",
        message: "Endpoint tidak ditemukan.",
      });
    } catch (err) {
      console.error("[api]", err);
      return json(res, 500, {
        error: "server_error",
        message: err.message || "Kesalahan server.",
      });
    }
  }

  return {
    config,
    handle,
    close: () => Promise.all([store.close(), stockStore.close()]),
  };
}

module.exports = { createApp };
