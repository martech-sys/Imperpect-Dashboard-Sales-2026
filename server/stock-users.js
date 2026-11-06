"use strict";

const crypto = require("node:crypto");
const { cocokHash } = require("./auth");

/**
 * User dashboard stok.
 *
 * - Admin utama: STOCK_USERNAME (bawaan stockwh) + STOCK_PASSWORD /
 *   STOCK_PASSWORD_HASH dari env. Tidak bisa dihapus dari dashboard.
 * - User lain disimpan di file JSON di repo GitHub ini
 *   (data/stock-users.json): username, role (admin/user), hash scrypt
 *   password, kapan dibuat & oleh siapa. Password asli tidak pernah disimpan.
 * - Admin menambah / menghapus / mengganti password user dari dashboard;
 *   server meng-commit file itu lewat GitHub API (perlu env
 *   STOCK_USERS_GITHUB_TOKEN). Daftar user dibaca langsung dari GitHub
 *   (cache 30 detik), jadi user baru bisa login tanpa menunggu deploy ulang.
 *   Tanpa token: memakai file yang ikut ter-deploy, dan tidak bisa diubah.
 *
 * Sesi: cookie bertanda tangan HMAC berisi username + kedaluwarsa + sidik
 * hash password-nya, jadi user yang dihapus / diganti password-nya otomatis
 * keluar.
 */

const COOKIE = "isd_stok";
const UMUR_DETIK = 7 * 24 * 3600;
const MAKS_PERCOBAAN = 8;
const JENDELA_MS = 10 * 60 * 1000;
const CACHE_MS = 30 * 1000;
const POLA_USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const ROLE = new Set(["admin", "user"]);

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const b64 = (s) => Buffer.from(String(s)).toString("base64url");
const unb64 = (s) => Buffer.from(String(s), "base64url").toString();

function sama(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Password → "scrypt:<salt>:<hash>". */
function buatHash(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const h = crypto.scryptSync(String(password), salt, 32).toString("base64url");
  return `scrypt:${salt}:${h}`;
}

function bacaFileBawaan() {
  try {
    // require supaya file ikut terbundel di Vercel Function
    const isi = require("../data/stock-users.json");
    return Array.isArray(isi.users) ? isi.users : [];
  } catch {
    return [];
  }
}

function createStockUsers(cfg, deps = {}) {
  const ambil = deps.fetch || globalThis.fetch;
  const admin = {
    username: String(cfg.admin.username || "")
      .trim()
      .toLowerCase(),
    password: cfg.admin.password || "",
    passwordHash: cfg.admin.passwordHash || "",
  };
  const aktif = Boolean(
    admin.username && (admin.password || admin.passwordHash),
  );
  const gh = cfg.github || {};
  const bisaUbah = Boolean(gh.token && gh.repo && gh.path);
  const kunci = sha(
    `stok-users:${cfg.secret || ""}:${admin.password || admin.passwordHash}`,
  );
  const percobaan = new Map();

  let cache = null; // { users, sha, at }

  // ---------------------------------------------------------------------------
  // Penyimpanan (GitHub)
  // ---------------------------------------------------------------------------

  const urlFile = () =>
    `https://api.github.com/repos/${gh.repo}/contents/${gh.path}`;
  const headerGh = () => ({
    Authorization: `Bearer ${gh.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "imperfect-stock-dashboard",
  });

  async function bacaGithub() {
    const res = await ambil(
      `${urlFile()}?ref=${encodeURIComponent(gh.branch || "main")}`,
      { headers: headerGh() },
    );
    if (res.status === 404) return { users: [], sha: null };
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    const body = await res.json();
    const isi = JSON.parse(
      Buffer.from(body.content || "", "base64").toString() || "{}",
    );
    return { users: Array.isArray(isi.users) ? isi.users : [], sha: body.sha };
  }

  async function daftarFile({ segar = false } = {}) {
    if (!bisaUbah) return { users: bacaFileBawaan(), sha: null };
    if (!segar && cache && Date.now() - cache.at < CACHE_MS) return cache;
    try {
      const d = await bacaGithub();
      cache = { ...d, at: Date.now() };
      return cache;
    } catch (e) {
      console.error("[stock-users]", e.message);
      // GitHub sedang tidak bisa dibaca: pakai data terakhir / file bawaan
      return cache || { users: bacaFileBawaan(), sha: null };
    }
  }

  async function simpan(users, pesan, shaLama) {
    const isi = `${JSON.stringify({ users }, null, 2)}\n`;
    const res = await ambil(urlFile(), {
      method: "PUT",
      headers: { ...headerGh(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: pesan,
        content: Buffer.from(isi).toString("base64"),
        branch: gh.branch || "main",
        ...(shaLama ? { sha: shaLama } : {}),
      }),
    });
    if (res.status === 409 || res.status === 422) {
      const err = new Error(
        "Daftar user baru saja diubah di tempat lain. Muat ulang lalu coba lagi.",
      );
      err.status = 409;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(
        `Gagal menyimpan ke GitHub (HTTP ${res.status}). Periksa STOCK_USERS_GITHUB_TOKEN.`,
      );
      err.status = 502;
      throw err;
    }
    const body = await res.json();
    cache = { users, sha: body.content?.sha || null, at: Date.now() };
  }

  /** Ubah daftar user: baca versi terbaru, ubah, simpan. */
  async function ubah(fn, pesan) {
    if (!bisaUbah) {
      const err = new Error(
        "Menambah/mengubah user belum aktif: isi STOCK_USERS_GITHUB_TOKEN di Vercel.",
      );
      err.status = 503;
      throw err;
    }
    const d = await daftarFile({ segar: true });
    const users = fn(d.users.map((u) => ({ ...u })));
    await simpan(users, pesan, d.sha);
  }

  // ---------------------------------------------------------------------------
  // User & password
  // ---------------------------------------------------------------------------

  async function cari(username) {
    const u = String(username || "")
      .trim()
      .toLowerCase();
    if (!u) return null;
    if (u === admin.username) {
      return {
        username: admin.username,
        role: "admin",
        utama: true,
        sidik: admin.password || admin.passwordHash,
      };
    }
    const { users } = await daftarFile();
    const f = users.find((x) => x.username === u);
    return f ? { ...f, utama: false, sidik: f.hash } : null;
  }

  function cocokPassword(user, diketik) {
    if (user.utama) {
      return admin.passwordHash
        ? cocokHash(diketik, admin.passwordHash)
        : sama(diketik, admin.password);
    }
    return cocokHash(diketik, user.hash);
  }

  // ---------------------------------------------------------------------------
  // Sesi
  // ---------------------------------------------------------------------------

  const tanda = (username, exp, sidik) =>
    crypto
      .createHmac("sha256", kunci)
      .update(`${username}|${exp}|${sha(sidik).toString("base64url")}`)
      .digest("base64url");

  function bacaCookie(header) {
    const c = String(header || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`));
    return c ? decodeURIComponent(c.slice(COOKIE.length + 1)) : "";
  }

  /** Cookie → { username, role, utama } atau null. */
  async function masuk(cookieHeader) {
    if (!aktif) return null;
    const [u, exp, sig] = bacaCookie(cookieHeader).split(".");
    if (!u || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
    let username;
    try {
      username = unb64(u);
    } catch {
      return null;
    }
    const user = await cari(username);
    if (!user || !sama(sig, tanda(user.username, exp, user.sidik))) return null;
    return { username: user.username, role: user.role, utama: user.utama };
  }

  async function cookieMasuk(username, aman) {
    const user = await cari(username);
    const exp = String(Math.floor(Date.now() / 1000) + UMUR_DETIK);
    const token = `${b64(user.username)}.${exp}.${tanda(user.username, exp, user.sidik)}`;
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${UMUR_DETIK}${aman ? "; Secure" : ""}`;
  }

  const cookieKeluar = () =>
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

  /** null bila berhasil, atau pesan kesalahan. */
  async function cobaMasuk(ip, username, password) {
    const kini = Date.now();
    const c = percobaan.get(ip);
    if (c && kini - c.mulai < JENDELA_MS && c.n >= MAKS_PERCOBAAN) {
      return "Terlalu banyak percobaan. Coba lagi dalam 10 menit.";
    }
    const user = await cari(username);
    if (user && cocokPassword(user, String(password || ""))) {
      percobaan.delete(ip);
      return null;
    }
    if (!c || kini - c.mulai >= JENDELA_MS)
      percobaan.set(ip, { mulai: kini, n: 1 });
    else c.n += 1;
    return "Username atau password salah.";
  }

  // ---------------------------------------------------------------------------
  // Kelola user (admin)
  // ---------------------------------------------------------------------------

  async function daftar() {
    const { users } = await daftarFile({ segar: true });
    return {
      bisaUbah,
      users: [
        { username: admin.username, role: "admin", utama: true },
        ...users.map((u) => ({
          username: u.username,
          role: u.role,
          dibuat: u.dibuat || null,
          oleh: u.oleh || null,
          diubah: u.diubah || null,
          utama: false,
        })),
      ],
    };
  }

  function galat(pesan, status = 400) {
    const err = new Error(pesan);
    err.status = status;
    return err;
  }

  function cekPassword(password) {
    if (typeof password !== "string" || password.length < 8)
      throw galat("Password minimal 8 karakter.");
    if (password.length > 200) throw galat("Password terlalu panjang.");
  }

  async function tambah({ username, password, role }, oleh) {
    const u = String(username || "")
      .trim()
      .toLowerCase();
    if (!POLA_USERNAME.test(u))
      throw galat(
        "Username 3–32 karakter: huruf kecil, angka, titik, minus, atau garis bawah.",
      );
    if (u === admin.username) throw galat("Username sudah dipakai.");
    cekPassword(password);
    const r = ROLE.has(role) ? role : "user";
    await ubah((users) => {
      if (users.some((x) => x.username === u))
        throw galat("Username sudah dipakai.");
      return [
        ...users,
        {
          username: u,
          role: r,
          hash: buatHash(password),
          dibuat: new Date().toISOString(),
          oleh,
        },
      ];
    }, `Dashboard stok: tambah user ${u} (oleh ${oleh})`);
  }

  async function hapus(username, oleh) {
    const u = String(username || "")
      .trim()
      .toLowerCase();
    if (u === admin.username)
      throw galat("Admin utama tidak bisa dihapus dari dashboard.");
    if (u === oleh) throw galat("Tidak bisa menghapus akun sendiri.");
    await ubah((users) => {
      if (!users.some((x) => x.username === u))
        throw galat("User tidak ditemukan.", 404);
      return users.filter((x) => x.username !== u);
    }, `Dashboard stok: hapus user ${u} (oleh ${oleh})`);
  }

  async function gantiPassword(username, password, oleh) {
    const u = String(username || "")
      .trim()
      .toLowerCase();
    if (u === admin.username)
      throw galat(
        "Password admin utama diganti lewat STOCK_PASSWORD di Vercel.",
      );
    cekPassword(password);
    await ubah((users) => {
      const x = users.find((y) => y.username === u);
      if (!x) throw galat("User tidak ditemukan.", 404);
      x.hash = buatHash(password);
      x.diubah = new Date().toISOString();
      return users;
    }, `Dashboard stok: ganti password ${u} (oleh ${oleh})`);
  }

  async function gantiRole(username, role, oleh) {
    const u = String(username || "")
      .trim()
      .toLowerCase();
    if (u === admin.username)
      throw galat("Role admin utama tidak bisa diubah.");
    if (u === oleh) throw galat("Tidak bisa mengubah role akun sendiri.");
    if (!ROLE.has(role)) throw galat("Role tidak dikenal.");
    await ubah((users) => {
      const x = users.find((y) => y.username === u);
      if (!x) throw galat("User tidak ditemukan.", 404);
      x.role = role;
      x.diubah = new Date().toISOString();
      return users;
    }, `Dashboard stok: role ${u} menjadi ${role} (oleh ${oleh})`);
  }

  return {
    aktif,
    bisaUbah,
    masuk,
    cookieMasuk,
    cookieKeluar,
    cobaMasuk,
    daftar,
    tambah,
    hapus,
    gantiPassword,
    gantiRole,
  };
}

module.exports = { createStockUsers, buatHash, POLA_USERNAME };
