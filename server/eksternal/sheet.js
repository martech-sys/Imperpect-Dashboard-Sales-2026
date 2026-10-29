"use strict";

/**
 * Membaca isi Sheet brand eksternal. Formatnya sama dengan Sheet brand papan
 * TV IMPERPECT-SALES-2026 (scripts/buat-sheet-brand.gs di repo itu): baris
 * pertama judul, satu baris = satu transaksi.
 *
 *   No HP | Nama | qty | trx value
 *
 * Kolom dikenali dari judulnya; tanpa judul yang dikenali, urutannya dianggap
 * HP, Nama, qty, nilai. Fungsi di sini disalin dari server/aggregate.js repo
 * itu supaya kedua aplikasi membaca Sheet yang sama dengan cara yang sama.
 */

/** "Rp 2.500.000", "2,500,000", "2500000.00" → 2500000. Tidak terbaca → NaN. */
function toNum(s) {
  if (typeof s === "number") return Number.isFinite(s) ? Math.round(s) : NaN;
  s = String(s == null ? "" : s).trim();
  if (!s) return NaN;
  s = s.replace(/rp\.?/gi, "").replace(/\s/g, "");
  // buang desimal di ujung (",50" / ".00"), pemisah ribuan dibuang sesudahnya
  const m = s.match(/^(.*?)[.,](\d{1,2})$/);
  if (m && /^[\d.,]*\d$/.test(m[1])) s = m[1];
  s = s.replace(/[^\d-]/g, "");
  return s ? parseInt(s, 10) : NaN;
}

/** 0812…, 62812…, +62 812… → 0812…; tidak sah → "". */
function normPhone(s) {
  // nomor yang diubah spreadsheet menjadi notasi ilmiah (6.28E+12) sudah rusak
  if (/e\+/i.test(String(s))) return "";
  let d = String(s == null ? "" : s).replace(/\D/g, "");
  if (d.indexOf("62") === 0) d = `0${d.slice(2)}`;
  else if (d.charAt(0) === "8") d = `0${d}`;
  return /^0\d{8,13}$/.test(d) ? d : "";
}

/** Nomor lengkap tidak pernah dikirim ke browser. */
const maskPhone = (d) => (d ? `${d.slice(0, 4)}-xxxx-${d.slice(-4)}` : "");

/** "dewi lestari" → "Dewi L." */
function shortName(s) {
  const w = String(s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!w.length) return "";
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
  return w.length > 1
    ? `${cap(w[0])} ${w[1].charAt(0).toUpperCase()}.`
    : cap(w[0]);
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let f = "";
  let q = false;
  text = String(text || "").replace(/^\ufeff/, "");
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (q) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          f += '"';
          i += 1;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text.charAt(i + 1) === "\n") i += 1;
      row.push(f);
      f = "";
      rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== "" || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
}

/** Baris Sheet → { baris, phone, name, qty, value } (nilai mentah). */
function rowsToRecords(rows) {
  if (!rows.length) return [];
  let idx = { p: 0, n: 1, q: 2, v: 3 };
  let start = 0;
  const first = rows[0];
  if (isNaN(toNum(first[2])) && isNaN(toNum(first[3]))) {
    start = 1;
    const m = {};
    first.forEach((h, i) => {
      h = String(h).toLowerCase();
      if (m.p == null && /hp|phone|telp|tlp|wa/.test(h)) m.p = i;
      else if (m.n == null && /nama|name/.test(h)) m.n = i;
      else if (m.q == null && /qty|jumlah|pcs/.test(h)) m.q = i;
      else if (m.v == null && /value|nilai|total|trx|omzet|sales/.test(h))
        m.v = i;
    });
    if (m.p != null && m.v != null) {
      idx = {
        p: m.p,
        n: m.n != null ? m.n : -1,
        q: m.q != null ? m.q : -1,
        v: m.v,
      };
    }
  }
  const out = [];
  for (let i = start; i < rows.length; i += 1) {
    const c = rows[i];
    out.push({
      baris: i + 1,
      phone: c[idx.p],
      name: idx.n >= 0 ? c[idx.n] : "",
      qty: idx.q >= 0 ? c[idx.q] : 0,
      value: c[idx.v],
    });
  }
  return out;
}

module.exports = {
  toNum,
  normPhone,
  maskPhone,
  shortName,
  parseCSV,
  rowsToRecords,
};
