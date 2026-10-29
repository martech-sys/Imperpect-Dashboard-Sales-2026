/**
 * Ringkasan manual brand eksternal — cadangan tab "Ringkasan Eksternal".
 *
 * Membaca semua Google Sheet brand di folder Drive (sama dengan DRIVE_FOLDER
 * dashboard) dan menulis ringkasan per brand ke spreadsheet tempat script ini
 * dipasang. Hitungannya sama dengan dashboard:
 *   TRX     = baris yang trx value-nya terbaca dan > 0
 *   Unit    = jumlah qty
 *   GMV     = jumlah trx value
 *   Pembeli = nomor HP berbeda (TOTAL: berbeda di seluruh brand)
 *   Baris tanpa nomor HP tetap dihitung penjualan.
 *
 * Cara pakai (oleh akun yang bisa membuka folder brand, mis. admin):
 *   1. Buat Google Sheet baru → Extensions → Apps Script.
 *   2. Hapus isinya, tempel file ini, isi FOLDER di bawah.
 *   3. Pilih fungsi ringkasanEksternal → Run → izinkan akses Drive & Sheets.
 *   4. Hasilnya di tab "Ringkasan Eksternal". Jalankan ulang kapan pun untuk
 *      angka terbaru. Hanya membaca file brand; tidak mengubah isinya.
 */

// Link atau ID folder Drive yang sama dengan DRIVE_FOLDER di Vercel.
var FOLDER = 'https://drive.google.com/drive/folders/ISI_ID_FOLDER';

function ringkasanEksternal() {
  var folderId = (FOLDER.match(/\/folders\/([a-zA-Z0-9_-]+)/) || [])[1] || FOLDER.trim();
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);

  var hasil = [];
  var semuaPembeli = {};
  while (files.hasNext()) {
    var f = files.next();
    var r = { brand: f.getName(), trx: 0, unit: 0, gmv: 0, pembeli: {}, dilewati: [], diubah: f.getLastUpdated(), galat: '' };
    try {
      var nilai = SpreadsheetApp.openById(f.getId()).getSheets()[0].getDataRange().getDisplayValues();
      var idx = kolom(nilai[0] || []);
      for (var i = idx.mulai; i < nilai.length; i++) {
        var b = nilai[i];
        if (b.join('').trim() === '') continue; // baris kosong
        var v = toNum(b[idx.v]);
        if (!(v > 0)) { r.dilewati.push(i + 1); continue; }
        var q = idx.q >= 0 ? toNum(b[idx.q]) : 0;
        r.trx += 1;
        r.unit += q > 0 ? q : 0;
        r.gmv += v;
        var hp = normHp(b[idx.p]);
        if (hp) { r.pembeli[hp] = true; semuaPembeli[hp] = true; }
      }
    } catch (e) {
      r.galat = String(e.message || e);
    }
    hasil.push(r);
  }

  hasil.sort(function (a, b) { return b.gmv - a.gmv || a.brand.localeCompare(b.brand); });
  var total = hasil.reduce(function (t, r) { t.trx += r.trx; t.unit += r.unit; t.gmv += r.gmv; return t; }, { trx: 0, unit: 0, gmv: 0 });

  var baris = [['Brand', 'TRX', 'Unit sold', 'GMV', 'Pembeli', 'Rata-rata / TRX', 'Kontribusi %', 'Terakhir diubah', 'Status']];
  hasil.forEach(function (r) {
    var status = r.galat ? 'Gagal dibaca: ' + r.galat
      : !r.trx ? 'Belum ada transaksi'
      : r.dilewati.length ? r.dilewati.length + ' baris dilewati (baris ' + r.dilewati.join(', ') + ')'
      : 'OK';
    baris.push([r.brand, r.trx, r.unit, r.gmv, Object.keys(r.pembeli).length,
      r.trx ? Math.round(r.gmv / r.trx) : 0,
      total.gmv ? Math.round((r.gmv / total.gmv) * 10000) / 100 : 0,
      r.diubah, status]);
  });
  baris.push(['TOTAL', total.trx, total.unit, total.gmv, Object.keys(semuaPembeli).length,
    total.trx ? Math.round(total.gmv / total.trx) : 0, total.gmv ? 100 : 0, new Date(), 'Dibuat ' + new Date()]);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Ringkasan Eksternal') || ss.insertSheet('Ringkasan Eksternal');
  sh.clearContents();
  sh.getRange(1, 1, baris.length, baris[0].length).setValues(baris);
  sh.getRange(1, 1, 1, baris[0].length).setFontWeight('bold');
  sh.getRange(baris.length, 1, 1, baris[0].length).setFontWeight('bold');
  sh.getRange(2, 4, baris.length - 1, 1).setNumberFormat('#,##0');
  sh.getRange(2, 6, baris.length - 1, 1).setNumberFormat('#,##0');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, baris[0].length);
}

/** Posisi kolom dari baris judul (No HP, Nama, qty, trx value); tanpa judul: HP, Nama, qty, nilai. */
function kolom(judul) {
  var idx = { p: 0, q: 2, v: 3, mulai: 0 };
  if (isNaN(toNum(judul[2])) && isNaN(toNum(judul[3]))) {
    idx.mulai = 1;
    var m = {};
    judul.forEach(function (h, i) {
      h = String(h).toLowerCase();
      if (m.p == null && /hp|phone|telp|tlp|wa/.test(h)) m.p = i;
      else if (m.n == null && /nama|name/.test(h)) m.n = i;
      else if (m.q == null && /qty|jumlah|pcs/.test(h)) m.q = i;
      else if (m.v == null && /value|nilai|total|trx|omzet|sales/.test(h)) m.v = i;
    });
    if (m.p != null && m.v != null) { idx.p = m.p; idx.q = m.q != null ? m.q : -1; idx.v = m.v; }
  }
  return idx;
}

/** "Rp 2.500.000", "2,500,000", "2500000.00" → 2500000; tidak terbaca → NaN. */
function toNum(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return NaN;
  s = s.replace(/rp\.?/gi, '').replace(/\s/g, '');
  var m = s.match(/^(.*?)[.,](\d{1,2})$/);
  if (m && /^[\d.,]*\d$/.test(m[1])) s = m[1];
  s = s.replace(/[^\d-]/g, '');
  return s ? parseInt(s, 10) : NaN;
}

/** 0812…, 62812…, +62 812… → 0812…; tidak sah → ''. */
function normHp(s) {
  if (/e\+/i.test(String(s))) return '';
  var d = String(s == null ? '' : s).replace(/\D/g, '');
  if (d.indexOf('62') === 0) d = '0' + d.slice(2);
  else if (d.charAt(0) === '8') d = '0' + d;
  return /^0\d{8,13}$/.test(d) ? d : '';
}
