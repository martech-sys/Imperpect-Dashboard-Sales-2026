"use strict";

const { luarSesi, jamTeks } = require("./sesi");

/**
 * Agregasi dashboard di atas baris yang sudah disiapkan store.js.
 *
 * Definisi angka:
 * - Unit sold = jumlah `qty`.
 * - TRX       = jumlah invoice berbeda. Invoice yang barisnya jatuh ke dua
 *               channel/brand dihitung di masing-masing kolom, tetapi sekali
 *               saja di kolom TOTAL — jadi TRX TOTAL bisa lebih kecil dari
 *               jumlah TRX per channel.
 * - GMV       = jumlah `total_harga_barang` (nilai tingkat baris produk), bukan
 *               `total_bayar`: total_bayar adalah total satu invoice yang
 *               berulang di tiap barisnya, sehingga menjumlahkannya menghitung
 *               invoice berisi tiga produk sebanyak tiga kali, dan tidak bisa
 *               dipecah per brand.
 */

const BULAN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

function tanggalHari(event, hari) {
  const d = new Date(`${event.dari}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari - 1);
  return d;
}

function jumlahHari(event) {
  return (
    Math.round(
      (Date.parse(`${event.sampai}T00:00:00Z`) -
        Date.parse(`${event.dari}T00:00:00Z`)) /
        86400000,
    ) + 1
  );
}

function labelHari(event, hari) {
  const d = tanggalHari(event, hari);
  return `Day ${hari} · ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}`;
}

/** Label sesi dari kuncinya ("2-3" → "Day 2 | Sesi 3 (13.00-14.00)"). */
function labelSesi(event, key) {
  if (!key) return "(tanpa tanggal)";
  const s = event.sesi.find((x) => x.key === key);
  if (s) return s.label;
  const hari = Number(String(key).split("-")[0]);
  return luarSesi(hari).label;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/** Nama pilihan filter untuk baris yang metode bayarnya kosong. */
const TANPA_METODE = "(tanpa metode bayar)";
const metodeBayar = (r) => r.payment_note || TANPA_METODE;

const KOLOM_CARI = [
  "invoice",
  "sku_produk",
  "nama_produk",
  "brand",
  "channel",
  "payment_note",
  "promo_kode",
  "kategori",
];

/** Query string → filter yang aman dipakai. Nilai kosong berarti "semua". */
function bacaFilter(query) {
  const ambil = (k) => {
    const v = query[k];
    const t = Array.isArray(v) ? v[0] : v;
    return typeof t === "string" ? t.trim() : "";
  };
  const hari = parseInt(ambil("hari"), 10);
  return {
    brand: ambil("brand"),
    hari: Number.isFinite(hari) ? hari : null,
    sesi: ambil("sesi"),
    channel: ambil("channel"),
    payment: ambil("payment"),
    q: ambil("q").toLowerCase().slice(0, 100),
  };
}

function saring(rows, f) {
  return rows.filter((r) => {
    if (f.brand && r.brand !== f.brand) return false;
    if (f.hari !== null && f.hari !== undefined && r.hari !== f.hari)
      return false;
    if (f.sesi && r.sesi !== f.sesi) return false;
    if (f.channel && r.channel !== f.channel) return false;
    if (f.payment && metodeBayar(r) !== f.payment) return false;
    if (
      f.q &&
      !KOLOM_CARI.some((k) => r[k] && String(r[k]).toLowerCase().includes(f.q))
    )
      return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Pivot Sesi × Channel
// ---------------------------------------------------------------------------

const BARIS = new Set(["sesi", "hari", "brand", "jam"]);
const URUT = new Set(["gmv", "qty", "trx", "nama"]);

const kelompokBaru = () => ({ qty: 0, gmv: 0, inv: new Set() });

function tambah(g, r) {
  g.qty += r.qty;
  g.gmv += r.total_harga_barang || 0;
  if (r.invoice) g.inv.add(r.invoice);
}

const rapikan = (g) => ({
  qty: g.qty,
  trx: g.inv.size,
  gmv: Math.round(g.gmv),
});

function kunciBaris(baris, r) {
  if (baris === "sesi") return r.sesi || "x";
  if (baris === "hari") return r.hari === null ? "x" : String(r.hari);
  if (baris === "brand") return r.brand;
  return r.menit === null ? "x" : String(Math.floor(r.menit / 60));
}

/**
 * Daftar baris yang ditampilkan, berurutan. Sesi dan hari yang terjadwal
 * selalu tampil walau kosong — sesi tanpa penjualan adalah informasi, bukan
 * baris yang boleh hilang. Baris "di luar sesi" hanya tampil bila ada isinya.
 */
function susunBaris(baris, event, f, adaData) {
  if (baris === "sesi") {
    const terjadwal = event.sesi
      .filter((s) => f.hari === null || s.hari === f.hari)
      .map((s) => s.key);
    const semua = new Set([...terjadwal, ...adaData.keys()]);
    const urutan = (k) => {
      if (k === "x") return [Infinity, 0];
      const [h, n] = k.split("-").map(Number);
      return [h, n === 0 ? Infinity : n];
    };
    return [...semua]
      .sort((a, b) => {
        const [ha, na] = urutan(a);
        const [hb, nb] = urutan(b);
        return ha - hb || na - nb;
      })
      .map((k) => ({
        key: k,
        label: labelSesi(event, k === "x" ? null : k),
        filter: k === "x" ? null : { sesi: k },
      }));
  }
  if (baris === "hari") {
    const semua = new Set(adaData.keys());
    for (let h = 1; h <= jumlahHari(event); h += 1) {
      if (f.hari === null || f.hari === h) semua.add(String(h));
    }
    return [...semua]
      .sort((a, b) => (a === "x" ? 1 : b === "x" ? -1 : Number(a) - Number(b)))
      .map((k) => ({
        key: k,
        label: k === "x" ? "(tanpa tanggal)" : labelHari(event, Number(k)),
        filter: k === "x" ? null : { hari: Number(k) },
      }));
  }
  if (baris === "brand") {
    return [...adaData.entries()]
      .sort((a, b) => b[1].gmv - a[1].gmv || a[0].localeCompare(b[0], "id"))
      .map(([k]) => ({ key: k, label: k, filter: { brand: k } }));
  }
  return [...adaData.keys()]
    .sort((a, b) => (a === "x" ? 1 : b === "x" ? -1 : Number(a) - Number(b)))
    .map((k) => ({
      key: k,
      label:
        k === "x"
          ? "(tanpa jam)"
          : `${jamTeks(Number(k) * 60)}-${jamTeks(Number(k) * 60 + 60)}`,
      filter: null,
    }));
}

function pivot(semuaRows, event, query) {
  const f = bacaFilter(query);
  // Pivot hanya disaring brand dan hari; sesi & channel adalah sumbunya.
  const filter = { ...f, sesi: "", channel: "", payment: "", q: "" };
  const baris = BARIS.has(query.baris) ? query.baris : "sesi";
  const urut = URUT.has(query.urut) ? query.urut : "gmv";
  const rows = saring(semuaRows, filter);

  const sel = new Map(); // kunci baris → (channel → kelompok)
  const perBaris = new Map();
  const perChannel = new Map();
  const total = kelompokBaru();

  // Kolom channel stabil: gudang event selalu tampil walau kosong di filter ini.
  const daftarChannel = new Set(
    event.kolomChannel === "warehouse" ? event.warehouse : [],
  );
  semuaRows.forEach((r) => daftarChannel.add(r.channel));
  daftarChannel.forEach((c) => perChannel.set(c, kelompokBaru()));

  for (const r of rows) {
    const k = kunciBaris(baris, r);
    if (!sel.has(k)) {
      sel.set(k, new Map());
      perBaris.set(k, kelompokBaru());
    }
    const peta = sel.get(k);
    if (!peta.has(r.channel)) peta.set(r.channel, kelompokBaru());
    tambah(peta.get(r.channel), r);
    tambah(perBaris.get(k), r);
    tambah(perChannel.get(r.channel), r);
    tambah(total, r);
  }

  const kolom = [...perChannel.entries()].map(([key, g]) => ({
    key,
    label: key,
    ...rapikan(g),
  }));
  kolom.sort((a, b) =>
    urut === "nama"
      ? a.label.localeCompare(b.label, "id")
      : b[urut] - a[urut] || a.label.localeCompare(b.label, "id"),
  );

  const kosong = { qty: 0, trx: 0, gmv: 0 };
  const hasilBaris = susunBaris(baris, event, f, perBaris).map((b) => {
    const peta = sel.get(b.key) || new Map();
    return {
      ...b,
      cells: Object.fromEntries(
        kolom.map((c) => [
          c.key,
          peta.has(c.key) ? rapikan(peta.get(c.key)) : kosong,
        ]),
      ),
      total: perBaris.has(b.key) ? rapikan(perBaris.get(b.key)) : kosong,
    };
  });

  const ringkasan = rapikan(total);
  return {
    baris,
    urut,
    filter: { brand: f.brand, hari: f.hari },
    columns: kolom,
    rows: hasilBaris,
    total: ringkasan,
    summary: {
      ...ringkasan,
      aov: ringkasan.trx ? Math.round(ringkasan.gmv / ringkasan.trx) : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Rincian transaksi
// ---------------------------------------------------------------------------

const SORTABLE = new Set(["tanggal", "channel", "invoice", "brand"]);

function nilaiUrut(r, kunci) {
  if (kunci === "tanggal") return `${r.tanggal || ""} ${r.waktu || ""}`;
  return r[kunci];
}

/**
 * Kunci pilihan pengguna selalu diikuti invoice, brand, lalu SKU — supaya
 * baris-baris satu invoice tetap berdampingan dan baris pembawa total bayar
 * selalu yang paling atas di kelompoknya.
 */
function pembanding(sortBy, arah) {
  const kunci = [sortBy, "invoice", "brand", "sku_produk"].filter(
    (k, n, d) => d.indexOf(k) === n,
  );
  return (a, b) => {
    for (const [n, k] of kunci.entries()) {
      const arahnya = n === 0 ? arah : 1;
      const kiri = nilaiUrut(a, k);
      const kanan = nilaiUrut(b, k);
      if (kiri === kanan) continue;
      if (kiri === null || kiri === undefined) return -arahnya;
      if (kanan === null || kanan === undefined) return arahnya;
      return String(kiri).localeCompare(String(kanan), "id") * arahnya;
    }
    return 0;
  };
}

/**
 * Kolom rincian & ekspor CSV, urutannya sama dengan tabel di halaman Rincian
 * Transaksi: [kunci baris, judul kolom CSV].
 */
const KOLOM_DETAIL = [
  ["brand", "brand"],
  ["tanggal", "tanggal"],
  ["waktu", "waktu"],
  ["invoice", "invoice"],
  ["sku_produk", "sku_produk"],
  ["nama_produk", "nama_produk"],
  ["kategori", "kategori"],
  ["channel", "channel"],
  ["qty", "qty"],
  ["total_harga_barang", "harga"],
  ["promo_value", "promo_value"],
  ["total_bayar", "total_bayar"],
  ["payment_note", "payment_method"],
  ["status", "status"],
];

function urutkan(semuaRows, query) {
  const f = bacaFilter(query);
  const sortBy = SORTABLE.has(query.sortBy) ? query.sortBy : "tanggal";
  const arah = String(query.sortDir).toLowerCase() === "asc" ? 1 : -1;
  const rows = saring(semuaRows, f);
  rows.sort(pembanding(sortBy, arah));
  return { f, rows, sortBy, sortDir: arah === 1 ? "asc" : "desc" };
}

/**
 * Baris → objek kirim. `total_bayar` dan `promo_value` berlaku untuk satu
 * invoice, jadi hanya ditulis di baris pertama invoice itu (null di baris
 * lanjutannya). Penandanya dihitung atas seluruh hasil sebelum dipotong
 * halaman, sehingga invoice yang terpotong batas halaman tidak menulis
 * totalnya dua kali.
 */
function keluaran(rows) {
  const sudah = new Set();
  return rows.map((r) => {
    const pertama = !sudah.has(r.invoice);
    sudah.add(r.invoice);
    const o = Object.fromEntries(KOLOM_DETAIL.map(([k]) => [k, r[k]]));
    if (!pertama) {
      o.total_bayar = null;
      o.promo_value = null;
    }
    return o;
  });
}

function transactions(semuaRows, query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    500,
    Math.max(1, parseInt(query.pageSize, 10) || 25),
  );
  const { rows, sortBy, sortDir } = urutkan(semuaRows, query);
  const semua = keluaran(rows);
  const g = kelompokBaru();
  rows.forEach((r) => tambah(g, r));
  const mulai = (page - 1) * pageSize;
  return {
    rows: semua.slice(mulai, mulai + pageSize),
    total: rows.length,
    page,
    pageSize,
    sortBy,
    sortDir,
    summary: rapikan(g),
  };
}

function csvSel(v) {
  const t = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const BATAS_CSV = 200000;

/** Ekspor CSV rincian, dipisah `;` dan diawali BOM supaya Excel membacanya rapi. */
function transactionsCsv(semuaRows, query) {
  const { rows } = urutkan(semuaRows, query);
  const isi = keluaran(rows.slice(0, BATAS_CSV));
  const baris = [
    KOLOM_DETAIL.map(([, judul]) => judul).join(";"),
    ...isi.map((o) => KOLOM_DETAIL.map(([k]) => csvSel(o[k])).join(";")),
  ];
  return `﻿${baris.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Pilihan filter
// ---------------------------------------------------------------------------

function opsiFilter(semuaRows, event) {
  const brands = new Set();
  const payments = new Set();
  const channels = new Set(
    event.kolomChannel === "warehouse" ? event.warehouse : [],
  );
  const sesiAda = new Set(event.sesi.map((s) => s.key));
  semuaRows.forEach((r) => {
    brands.add(r.brand);
    channels.add(r.channel);
    payments.add(metodeBayar(r));
    if (r.sesi) sesiAda.add(r.sesi);
  });
  const urutSesi = [...sesiAda].sort((a, b) => {
    const [ha, na] = a.split("-").map(Number);
    const [hb, nb] = b.split("-").map(Number);
    return ha - hb || (na || Infinity) - (nb || Infinity);
  });
  const hari = [];
  for (let h = 1; h <= jumlahHari(event); h += 1)
    hari.push({ value: h, label: labelHari(event, h) });
  return {
    brands: [...brands].sort((a, b) => a.localeCompare(b, "id")),
    channels: [...channels].sort((a, b) => a.localeCompare(b, "id")),
    payments: [...payments].sort((a, b) => a.localeCompare(b, "id")),
    hari,
    sesi: urutSesi.map((k) => ({
      value: k,
      hari: Number(k.split("-")[0]),
      label: labelSesi(event, k),
    })),
  };
}

module.exports = {
  bacaFilter,
  saring,
  pivot,
  transactions,
  transactionsCsv,
  opsiFilter,
  labelHari,
  labelSesi,
  jumlahHari,
  KOLOM_DETAIL,
};
