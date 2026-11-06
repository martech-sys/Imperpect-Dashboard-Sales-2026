"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");

/** GitHub Contents API tiruan: satu file, sha berganti tiap simpan. */
function githubPalsu() {
  const g = { isi: null, sha: null, commit: [], n: 0 };
  g.fetch = async (url, opts = {}) => {
    assert.match(
      url,
      /api\.github\.com\/repos\/.+\/contents\/data\/stock-users\.json/,
    );
    assert.match(opts.headers.Authorization, /^Bearer token-uji$/);
    const jawab = (status, body) => ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    });
    if (!opts.method || opts.method === "GET") {
      if (g.isi === null) return jawab(404, {});
      return jawab(200, {
        content: Buffer.from(g.isi).toString("base64"),
        sha: g.sha,
      });
    }
    const body = JSON.parse(opts.body);
    if ((body.sha || null) !== g.sha) return jawab(409, {});
    g.isi = Buffer.from(body.content, "base64").toString();
    g.sha = `sha${++g.n}`;
    g.commit.push(body.message);
    return jawab(200, { content: { sha: g.sha } });
  };
  return g;
}

async function panggil(app, url, { method = "GET", body, cookie } = {}) {
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(b) {
      this.body = b;
    },
  };
  await app.handle(
    { url, method, headers: cookie ? { cookie } : {}, body },
    res,
  );
  return {
    status: res.statusCode,
    headers: res.headers,
    body: JSON.parse(res.body),
  };
}

async function login(app, username, password) {
  const r = await panggil(app, "/api/stock/login", {
    method: "POST",
    body: { username, password },
  });
  return r.status === 200 ? r.headers["Set-Cookie"].split(";")[0] : null;
}

const ENV = {
  DEMO_MODE: "1",
  STOCK_PASSWORD: "admin-uji",
  STOCK_USERS_GITHUB_TOKEN: "token-uji",
};

test("admin menambah user; user baru bisa login tapi tidak bisa kelola user", async () => {
  const gh = githubPalsu();
  const app = createApp(ENV, { fetch: gh.fetch });
  try {
    const admin = await login(app, "stockwh", "admin-uji");
    assert.ok(admin);
    const info = await panggil(app, "/api/stock/app", { cookie: admin });
    assert.deepEqual(info.body.auth.user, {
      username: "stockwh",
      role: "admin",
      utama: true,
    });

    const tambah = await panggil(app, "/api/stock/users", {
      method: "POST",
      cookie: admin,
      body: { aksi: "tambah", username: "Budi", password: "rahasia123" },
    });
    assert.equal(tambah.status, 200);
    assert.deepEqual(
      tambah.body.users.map((u) => [u.username, u.role, u.oleh || null]),
      [
        ["stockwh", "admin", null],
        ["budi", "user", "stockwh"],
      ],
    );
    assert.equal(gh.commit.length, 1);
    assert.match(gh.commit[0], /tambah user budi/);
    // yang tersimpan di repo hanya hash, bukan password
    assert.doesNotMatch(gh.isi, /rahasia123/);
    assert.match(gh.isi, /"hash": "scrypt:/);

    const budi = await login(app, "budi", "rahasia123");
    assert.ok(budi);
    assert.equal(
      (await panggil(app, "/api/stock", { cookie: budi })).status,
      200,
    );
    assert.equal(
      (await panggil(app, "/api/stock/users", { cookie: budi })).status,
      403,
    );
    assert.equal(await login(app, "budi", "salah-banget"), null);

    // username dobel & password pendek ditolak
    const dobel = await panggil(app, "/api/stock/users", {
      method: "POST",
      cookie: admin,
      body: { aksi: "tambah", username: "budi", password: "rahasia123" },
    });
    assert.equal(dobel.status, 400);
    const pendek = await panggil(app, "/api/stock/users", {
      method: "POST",
      cookie: admin,
      body: { aksi: "tambah", username: "sari", password: "123" },
    });
    assert.equal(pendek.status, 400);

    // ganti password: sesi lama budi keluar, password baru berlaku
    await panggil(app, "/api/stock/users", {
      method: "POST",
      cookie: admin,
      body: { aksi: "password", username: "budi", password: "baru-12345" },
    });
    assert.equal(
      (await panggil(app, "/api/stock", { cookie: budi })).status,
      401,
    );
    const budi2 = await login(app, "budi", "baru-12345");
    assert.ok(budi2);

    // jadikan admin, lalu hapus: sesi ikut tidak berlaku
    await panggil(app, "/api/stock/users", {
      method: "POST",
      cookie: admin,
      body: { aksi: "role", username: "budi", role: "admin" },
    });
    assert.equal(
      (await panggil(app, "/api/stock/users", { cookie: budi2 })).status,
      200,
    );
    const hapus = await panggil(app, "/api/stock/users", {
      method: "POST",
      cookie: admin,
      body: { aksi: "hapus", username: "budi" },
    });
    assert.equal(hapus.status, 200);
    assert.equal(hapus.body.users.length, 1);
    assert.equal(
      (await panggil(app, "/api/stock", { cookie: budi2 })).status,
      401,
    );

    // admin utama tidak bisa dihapus
    const hapusAdmin = await panggil(app, "/api/stock/users", {
      method: "POST",
      cookie: admin,
      body: { aksi: "hapus", username: "stockwh" },
    });
    assert.equal(hapusAdmin.status, 400);
  } finally {
    await app.close();
  }
});

test("tanpa STOCK_USERS_GITHUB_TOKEN: daftar user terbaca, tambah user ditolak", async () => {
  const app = createApp({ DEMO_MODE: "1", STOCK_PASSWORD: "admin-uji" });
  try {
    const admin = await login(app, "stockwh", "admin-uji");
    const d = await panggil(app, "/api/stock/users", { cookie: admin });
    assert.equal(d.status, 200);
    assert.equal(d.body.bisaUbah, false);
    const t = await panggil(app, "/api/stock/users", {
      method: "POST",
      cookie: admin,
      body: { aksi: "tambah", username: "budi", password: "rahasia123" },
    });
    assert.equal(t.status, 503);
    assert.match(t.body.message, /STOCK_USERS_GITHUB_TOKEN/);
  } finally {
    await app.close();
  }
});
