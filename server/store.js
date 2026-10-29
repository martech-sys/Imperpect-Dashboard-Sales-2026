"use strict";

const { createPenentuSesi } = require("./sesi");

/**
 * Status yang tidak dihitung sebagai penjualan, sama dengan dashboard
 * OFFLINE-STORE: `Cancel` batal dan `Open` belum dibayar. Dicocokkan persis,
 * bukan lewat awalan, supaya status baru yang kebetulan berawalan sama tidak
 * ikut terbuang.
 */
const STATUS_BUKAN_PENJUALAN = new Set(["cancel", "batal", "open"]);

const bukanPenjualan = (status) =>
  STATUS_BUKAN_PENJUALAN.has(
    String(status ?? "")
      .trim()
      .toLowerCase(),
  );

/**
 * pg mengembalikan NUMERIC/BIGINT sebagai teks ("2500000.0000"). Nilai kosong
 * tetap null — harga kosong bukan harga nol.
 */
function angka(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

const teks = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
};

/** Baris query → baris siap agregasi, lengkap dengan hari dan sesinya. */
function siapkan(rawRows, event) {
  const tentukan = createPenentuSesi(event.sesi, event.dari);
  const rows = [];
  let dibuang = 0;
  for (const r of rawRows) {
    if (bukanPenjualan(r.status)) {
      dibuang += 1;
      continue;
    }
    const tanggal = teks(r.tanggal);
    const waktu = teks(r.waktu);
    const posisi = tentukan(tanggal, waktu);
    rows.push({
      tanggal,
      waktu:
        posisi.menit === null ? null : waktu.match(/\d{1,2}:\d{2}(:\d{2})?/)[0],
      menit: posisi.menit,
      hari: posisi.hari,
      sesi: posisi.sesi,
      channel: teks(r.channel) || "(tanpa channel)",
      invoice: teks(r.invoice),
      payment_note: teks(r.payment_note),
      total_bayar: angka(r.total_bayar),
      qty: angka(r.qty) || 0,
      total_harga_barang: angka(r.total_harga_barang),
      brand: teks(r.brand) || "(tanpa brand)",
      sku_produk: teks(r.sku_produk),
      nama_produk: teks(r.nama_produk),
      kategori: teks(r.kategori),
      warna: teks(r.warna),
      ukuran: teks(r.ukuran),
      promo_kode: teks(r.promo_kode),
      promo_value: angka(r.promo_value),
      status: teks(r.status),
    });
  }
  return { rows, dibuang };
}

/**
 * Membaca sumber paling sering sekali per `cacheSeconds`, berapa pun
 * permintaan yang masuk; permintaan yang datang bersamaan menunggu satu
 * pembacaan yang sama. Kalau pembacaan gagal, data terakhir yang berhasil
 * tetap dipakai (ditandai `stale`) — database yang restart sebentar tidak
 * mengosongkan dashboard.
 *
 * Stale-while-revalidate: begitu sudah ada data, permintaan tidak pernah
 * menunggu database. Data yang lewat `cacheSeconds` langsung dikirim, dan
 * pembacaan baru berjalan di belakang untuk permintaan berikutnya. Hanya
 * permintaan pertama sebuah instance yang menunggu query. `opts.waitUntil`
 * (Vercel) menjaga pembacaan di belakang tetap jalan sesudah jawaban terkirim.
 *
 * `segar: true` (tombol Refresh) menunggu pembacaan baru bila data sudah
 * lebih tua dari SEGAR_MIN_MS, supaya Refresh benar-benar menampilkan angka
 * terbaru tanpa membiarkan klik beruntun membebani database.
 */
const SEGAR_MIN_MS = 10_000;

function createStore(source, event, opts = {}) {
  const cacheMs = (opts.cacheSeconds || 60) * 1000;
  const now = opts.now || (() => Date.now());
  let data = null;
  let fetchedAt = null;
  let error = null;
  let lastAttempt = 0;
  let running = null;

  async function baca() {
    lastAttempt = now();
    try {
      const hasil = await source.fetch();
      // Sumber boleh mengembalikan array saja, atau { rows, event, uji } bila
      // event yang dipakai menghitung hari/sesi berbeda (mode uji).
      const raw = Array.isArray(hasil) ? { rows: hasil, event } : hasil;
      data = {
        ...siapkan(raw.rows, raw.event || event),
        event: raw.event || event,
        uji: raw.uji || null,
      };
      fetchedAt = new Date(now()).toISOString();
      error = null;
    } catch (e) {
      error = e.message || String(e);
      console.error(`[${source.name}] ${error}`);
    }
  }

  function mulai() {
    if (!running) {
      running = baca().finally(() => (running = null));
      if (opts.waitUntil) opts.waitUntil(running);
    }
    return running;
  }

  return {
    /** `tunggu: true` menunggu pembacaan baru walau data lama ada (dipakai tes). */
    async get({ tunggu = false, segar = false } = {}) {
      const umur = now() - lastAttempt;
      if (segar && umur >= SEGAR_MIN_MS) await mulai();
      else if (umur >= cacheMs || (!data && !error)) {
        const p = mulai();
        if (!data || tunggu) await p;
      }
      return {
        rows: data ? data.rows : null,
        dibuang: data ? data.dibuang : 0,
        event: data ? data.event : event,
        kesegaran: {
          sumber: source.name,
          uji: data ? data.uji : null,
          fetchedAt,
          error,
          stale: Boolean(error && data),
          memperbarui: Boolean(running),
          cacheSeconds: cacheMs / 1000,
        },
      };
    },
    close: () => source.close(),
  };
}

module.exports = {
  SEGAR_MIN_MS,
  createStore,
  siapkan,
  bukanPenjualan,
  angka,
};
