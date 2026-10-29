"use strict";

const { createDriveSource } = require("./drive");
const { toNum, normPhone, maskPhone, shortName } = require("./sheet");

/**
 * Brand eksternal: brand yang mencatat transaksinya sendiri di Sheet per brand
 * (bukan lewat warehouse), sama dengan sumber `drive` papan TV
 * IMPERPECT-SALES-2026.
 *
 * Sheet tidak punya tanggal, jam, atau invoice, jadi angkanya dihitung per
 * baris: TRX = jumlah baris bernilai, Unit = jumlah qty, GMV = jumlah
 * trx value, Pembeli = nomor HP berbeda. Baris yang nilainya kosong/nol/tidak
 * terbaca dilewati dan dilaporkan nomor barisnya. Berbeda dengan papan TV,
 * baris tanpa nomor HP tetap dihitung sebagai penjualan — hanya tidak masuk
 * hitungan pembeli.
 */

// ---------------------------------------------------------------------------
// Sumber & cache
// ---------------------------------------------------------------------------

const DEMO_BRANDS = [
  "Shi by Shireen",
  "Zaskia Sungkar",
  "L by LCB",
  "Haidee Orlin",
  "Rurik",
  "Lozy Hijab",
  "Klamby",
  "Geulis",
  "Erspo",
  "Ground Studio",
  "Herschel (Primer Group)",
  "Casio",
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Data contoh bila DRIVE_FOLDER belum diisi; deterministik. */
function createDemoSource() {
  return {
    name: "demo",
    async fetch() {
      const acak = mulberry32(2026);
      const nama = [
        "Dewi Lestari",
        "Rina Putri",
        "Siti Aminah",
        "Ayu",
        "Nadia Sari",
        "Fitri Handayani",
      ];
      return DEMO_BRANDS.map((brand, b) => {
        // satu brand belum mengisi apa pun, satu lagi gagal dibaca
        const jumlah =
          b === DEMO_BRANDS.length - 1 ? 0 : 5 + Math.floor(acak() * 40);
        const records = [];
        for (let i = 0; i < jumlah; i += 1) {
          const hp = `0812${String(Math.floor(acak() * 1e8)).padStart(8, "0")}`;
          records.push({
            baris: i + 2,
            phone: acak() < 0.1 ? "" : hp,
            name: nama[Math.floor(acak() * nama.length)],
            qty: String(1 + Math.floor(acak() * 4)),
            value:
              i === 3 && b === 2
                ? ""
                : String((1 + Math.floor(acak() * 30)) * 50000),
          });
        }
        return {
          brand,
          diubah: new Date(Date.UTC(2026, 9, 30, 2 + b, 15)).toISOString(),
          records,
          error:
            b === 5
              ? "HTTP 403: The caller does not have permission (contoh)"
              : null,
        };
      });
    },
  };
}

/**
 * Cache bersama: Drive dibaca paling sering sekali per `cacheSeconds`, berapa
 * pun yang membuka tab ini. Kalau pembacaan gagal, isi terakhir tetap dipakai.
 */
function createEksternal(cfg, opts = {}) {
  const cacheMs = (opts.cacheSeconds || 60) * 1000;
  let source = null;
  let configError = null;
  if (!cfg.folder) source = createDemoSource();
  else {
    try {
      source = createDriveSource(cfg);
    } catch (e) {
      configError = e.message;
    }
  }
  let files = null;
  let fetchedAt = null;
  let error = configError;
  let lastAttempt = 0;
  let running = null;

  async function baca() {
    lastAttempt = Date.now();
    try {
      files = await source.fetch();
      fetchedAt = new Date().toISOString();
      error = null;
    } catch (e) {
      error = e.message || String(e);
      console.error(`[eksternal] ${error}`);
    }
  }

  return {
    /** Stale-while-revalidate, sama dengan server/store.js. */
    async get({ tunggu = false } = {}) {
      if (
        source &&
        (Date.now() - lastAttempt >= cacheMs || (!files && !error))
      ) {
        if (!running) {
          running = baca().finally(() => (running = null));
          if (opts.waitUntil) opts.waitUntil(running);
        }
        if (!files || tunggu) await running;
      }
      return {
        files,
        kesegaran: {
          sumber: source ? source.name : "drive",
          fetchedAt,
          error,
          stale: Boolean(error && files),
          memperbarui: Boolean(running),
          cacheSeconds: cacheMs / 1000,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------------

function hitungBrand(f) {
  const pembeli = new Set();
  const dilewati = [];
  let trx = 0;
  let qty = 0;
  let gmv = 0;
  const baris = f.records.map((r) => {
    const nilai = toNum(r.value);
    const q = toNum(r.qty);
    const hp = normPhone(r.phone);
    const valid = nilai > 0;
    if (valid) {
      trx += 1;
      qty += q > 0 ? q : 0;
      gmv += nilai;
      if (hp) pembeli.add(hp);
    } else dilewati.push(r.baris);
    return { r, nilai, q, hp, valid };
  });
  return {
    ringkas: {
      brand: f.brand,
      trx,
      qty,
      gmv,
      pembeli: pembeli.size,
      aov: trx ? Math.round(gmv / trx) : 0,
      dilewati: dilewati.length,
      diubah: f.diubah,
      error: f.error,
    },
    baris,
    dilewati,
    pembeliSet: pembeli,
  };
}

function ringkasan(files) {
  const semuaPembeli = new Set();
  const brands = files.map((f) => {
    const h = hitungBrand(f);
    h.pembeliSet.forEach((p) => semuaPembeli.add(p));
    return h.ringkas;
  });
  const total = brands.reduce(
    (t, b) => ({ trx: t.trx + b.trx, qty: t.qty + b.qty, gmv: t.gmv + b.gmv }),
    { trx: 0, qty: 0, gmv: 0 },
  );
  brands.forEach((b) => {
    b.kontribusi = total.gmv ? (b.gmv / total.gmv) * 100 : 0;
  });
  brands.sort((a, b) => b.gmv - a.gmv || a.brand.localeCompare(b.brand, "id"));
  return {
    summary: {
      ...total,
      aov: total.trx ? Math.round(total.gmv / total.trx) : 0,
      pembeli: semuaPembeli.size,
      brand: brands.length,
      brandAktif: brands.filter((b) => b.trx > 0).length,
      brandGagal: brands.filter((b) => b.error).length,
    },
    brands,
  };
}

/**
 * Tampilan satu brand: ringkasannya, pembeli teratas, dan seluruh barisnya.
 * Nomor HP disamarkan dan nama dipendekkan di server.
 */
function detailBrand(files, brand) {
  const f = files.find((x) => x.brand === brand);
  if (!f) return null;
  const h = hitungBrand(f);
  const perPembeli = new Map();
  h.baris.forEach(({ r, nilai, q, hp, valid }) => {
    if (!valid || !hp) return;
    const e = perPembeli.get(hp) || {
      hp: maskPhone(hp),
      nama: "",
      trx: 0,
      qty: 0,
      gmv: 0,
    };
    e.nama = e.nama || shortName(r.name);
    e.trx += 1;
    e.qty += q > 0 ? q : 0;
    e.gmv += nilai;
    perPembeli.set(hp, e);
  });
  return {
    ...h.ringkas,
    barisDilewati: h.dilewati,
    pembeliTeratas: [...perPembeli.values()]
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 10),
    rows: h.baris.map(({ r, nilai, q, hp, valid }) => ({
      baris: r.baris,
      nama: shortName(r.name),
      hp: maskPhone(hp),
      qty: q > 0 ? q : 0,
      nilai: valid ? nilai : null,
      valid,
    })),
  };
}

module.exports = { createEksternal, ringkasan, detailBrand, hitungBrand };
