/**
 * Laporan per sesi langsung dari Jubelio — pembanding dashboard.
 *
 * Mengambil data dengan cara yang sama seperti script "Sinkron Jubelio" papan
 * TV: login → minta laporan Sales List (lokasi LDS, rentang event) → unduh
 * Excel → baca. Hanya 3 request per run, jadi tidak kena batas request
 * (HTTP 429) seperti GET /sales/orders/ per halaman.
 *
 * Hasilnya ditulis ke spreadsheet BARU yang dibuat otomatis (link-nya muncul
 * di Execution log; sheet lama tempat script ini terpasang tidak diubah).
 * Nama fungsi & variabel diberi awalan jb/Jubelio supaya tidak bentrok dengan
 * script lain di project yang sama:
 *   - "Jubelio per Sesi": TRX & GMV per Day × Sesi per lokasi, plus kolom
 *     dashboard dan selisihnya (bila DASHBOARD_URL diisi).
 *   - "Jubelio Order"   : satu baris per pesanan (no. pesanan, waktu WIB,
 *     lokasi, status, qty, grand total) untuk dicek satu per satu.
 * Nama & nomor HP pelanggan dari laporan TIDAK ikut ditulis.
 *
 * Hitungan:
 *   TRX = jumlah No Pesanan, GMV = Grand Total (sekali per pesanan, total
 *   bayar). Pesanan dengan status cancel/batal tidak dihitung.
 *   Sesi = aturan yang sama dengan dashboard: jam mulai sesi s/d jam mulai
 *   sesi berikutnya (+ buffer per hari), sesi terakhir s/d akhir hari,
 *   sebelum sesi pertama = "Di luar sesi".
 *
 * Cara pakai:
 *   1. Di project Apps Script yang sudah ada: klik + → Script, beri nama
 *      "jubelio", tempel file ini (jangan menimpa file lain).
 *   2. Services (ikon + di samping "Services") → Drive API → Add (untuk membaca
 *      file Excel laporan). Lewati bila sudah ada.
 *   3. Project Settings → Script Properties, tambahkan:
 *        JUBELIO_EMAIL     email login Jubelio
 *        JUBELIO_PASSWORD  password-nya
 *      (jangan ditulis di kode).
 *   4. Isi DASHBOARD_URL di bawah (alamat dashboard Vercel) bila ingin kolom
 *      pembanding dashboard.
 *   5. Pilih fungsi laporanJubelio → Run → izinkan akses. Run pertama membuat
 *      spreadsheet "Laporan Jubelio per Sesi - Imperfect Sale 2026" di Drive;
 *      link-nya ada di Execution log. Run berikutnya menimpa file yang sama.
 *   6. Opsional: jalankan pasangJadwalJubelio sekali → laporan diperbarui tiap
 *      15 menit. Matikan dengan hapusJadwalJubelio.
 */

var JB_CONFIG = {
  API: 'https://api2.jubelio.com',
  REPORT_API: 'https://open.jubelio.com/core-api',
  LDS: [26, 64], // ID lokasi Jubelio, sama dengan script papan TV
  PREFIX: '', // hanya No Pesanan berawalan ini (mis. 'JP'); '' = semua pesanan
  DARI: '2026-10-30', // Day 1
  SAMPAI: '2026-11-01',
  // Jadwal sesi per Day (label tiket), sama dengan dashboard
  SESI: {
    1: ['09:00-10:00', '13:00-14:00', '15:00-16:00', '17:00-18:00', '19:00-20:00'],
    2: ['09:00-10:00', '11:00-12:00', '13:00-14:00', '15:00-16:00', '17:00-18:00', '19:00-20:00'],
    3: ['09:00-10:00', '11:00-12:00', '13:00-14:00', '15:00-16:00', '17:00-18:00', '19:00-20:00']
  },
  // Buffer batas antar sesi (menit) per Day, sama dengan EVENT_SESI_BUFFER dashboard
  BUFFER: { 2: 15 },
  // Alamat dashboard, mis. 'https://nama-project.vercel.app'. Kosong = tanpa pembanding.
  DASHBOARD_URL: '',
  // Laporan ditulis ke spreadsheet BARU (bukan sheet tempat script terpasang)
  NAMA_FILE: 'Laporan Jubelio per Sesi - Imperfect Sale 2026',
  TAB_REPORT: 'Jubelio per Sesi',
  TAB_ORDER: 'Jubelio Order',
  ZONA: 'Asia/Jakarta'
};

function laporanJubelio() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { Logger.log('Laporan sebelumnya masih jalan, dilewati.'); return; }
  try {
    var hasil = jbOlahLaporan_(ambilLaporanJubelio_());
    var order = hasil.order;
    var sesi = jbSesi_();
    var ringkas = jbRingkas_(order, sesi);
    var dashboard = jbDashboard_();
    jbTulisLaporan_(ringkas, sesi, dashboard, order, hasil);
    jbTulisOrder_(order);
    Logger.log('Pesanan: ' + order.length + ', cancel: ' + hasil.cancel +
      ', lokasi: ' + JSON.stringify(hasil.perLokasi));
    Logger.log('Laporan: ' + jbSpreadsheet_().getUrl());
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Jubelio
// ---------------------------------------------------------------------------

/**
 * UrlFetch dengan coba ulang saat Jubelio membatasi (HTTP 429) atau sibuk
 * (5xx): tunggu Retry-After bila ada, selain itu 5, 10, 20, 40, 60 detik.
 */
function jbFetch_(url, opts) {
  var tunggu = [5, 10, 20, 40, 60];
  for (var i = 0; ; i++) {
    var res = UrlFetchApp.fetch(url, opts);
    var kode = res.getResponseCode();
    if ((kode !== 429 && kode < 500) || i >= tunggu.length) return res;
    var h = res.getHeaders() || {};
    var ra = Number(h['Retry-After'] || h['retry-after']);
    var detik = ra > 0 ? Math.min(ra, 60) : tunggu[i];
    Logger.log('Jubelio HTTP ' + kode + ', coba lagi dalam ' + detik + ' detik');
    Utilities.sleep(detik * 1000);
  }
}

function loginJubelio_(baru) {
  // token disimpan 6 jam supaya tidak login ulang tiap run
  var cache = CacheService.getScriptCache();
  var simpan = baru ? null : cache.get('jb_token');
  if (simpan) return simpan;
  var p = PropertiesService.getScriptProperties();
  var email = p.getProperty('JUBELIO_EMAIL');
  var password = p.getProperty('JUBELIO_PASSWORD');
  if (!email || !password) {
    throw new Error('Isi Script Properties JUBELIO_EMAIL dan JUBELIO_PASSWORD dulu (Project Settings).');
  }
  var res = jbFetch_(JB_CONFIG.API + '/login', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ email: email, password: password }),
    muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !body.token) {
    throw new Error('Login Jubelio gagal: HTTP ' + res.getResponseCode());
  }
  cache.put('jb_token', body.token, 6 * 3600);
  return body.token; // dipakai apa adanya di header Authorization, tanpa "Bearer"
}

/** Laporan Sales List Jubelio (Excel) → isi tab pertamanya (baris 1 = judul kolom). */
function ambilLaporanJubelio_() {
  var akhir = new Date(JB_CONFIG.SAMPAI + 'T23:59:59+07:00');
  if (akhir > new Date()) akhir = new Date();
  var q = 'date_from=' + encodeURIComponent(jbTglJubelio_(new Date(JB_CONFIG.DARI + 'T00:00:00+07:00'))) +
    '&date_to=' + encodeURIComponent(jbTglJubelio_(akhir)) +
    '&reference=order&hpp=false&tz=Asia%2FJakarta&' +
    JB_CONFIG.LDS.map(function (v, i) { return 'lds%5B' + i + '%5D=' + v; }).join('&');
  var url = JB_CONFIG.REPORT_API + '/reports/sales-list/date-range/?' + q;

  var token = loginJubelio_();
  var rep = jbFetch_(url, { headers: { Authorization: token }, muteHttpExceptions: true });
  if (rep.getResponseCode() === 401) {
    // token tersimpan kedaluwarsa: login ulang sekali
    token = loginJubelio_(true);
    rep = jbFetch_(url, { headers: { Authorization: token }, muteHttpExceptions: true });
  }
  if (rep.getResponseCode() !== 200) {
    throw new Error('Laporan Jubelio gagal (HTTP ' + rep.getResponseCode() + '): ' + rep.getContentText().slice(0, 200));
  }
  var parts = JSON.parse(rep.getContentText()).url.split('?');
  var xlsx = jbFetch_(parts[0].replace(/\/+$/, '') + '/xlsx/?' + parts.slice(1).join('?'), { muteHttpExceptions: true });
  if (xlsx.getResponseCode() !== 200) throw new Error('Unduh Excel Jubelio gagal (HTTP ' + xlsx.getResponseCode() + ')');

  // Excel → Google Sheet sementara di My Drive → baca → buang
  var blob = xlsx.getBlob().setContentType(MimeType.MICROSOFT_EXCEL);
  var nama = 'tmp-jubelio-sesi-' + Date.now();
  var tmpId = Drive.Files.create
    ? Drive.Files.create({ name: nama, mimeType: MimeType.GOOGLE_SHEETS }, blob).id // Drive API v3
    : Drive.Files.insert({ title: nama, mimeType: MimeType.GOOGLE_SHEETS }, blob, { convert: true }).id; // v2
  try {
    var ss = SpreadsheetApp.openById(tmpId);
    // tanggal di Excel dibaca sebagai jam WIB
    ss.setSpreadsheetTimeZone(JB_CONFIG.ZONA);
    return ss.getSheets()[0].getDataRange().getValues();
  } finally {
    Drive.Files.remove(tmpId);
  }
}

function jbTglJubelio_(d) {
  return Utilities.formatDate(d, JB_CONFIG.ZONA, 'EEE MMM dd yyyy HH:mm:ss') + ' GMT+0700 (Western Indonesia Time)';
}

/**
 * Isi laporan → satu entri per No Pesanan: { no, waktu, lokasi, status, qty,
 * nilai }. Grand Total diambil SEKALI per pesanan (laporan bisa satu baris
 * per item), qty dijumlahkan, pesanan cancel/batal dibuang.
 */
function jbOlahLaporan_(values) {
  if (!values.length) return { order: [], cancel: 0, perLokasi: {}, tanpaJam: false };
  var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  function col(res, wajib) {
    for (var j = 0; j < res.length; j++) {
      for (var i = 0; i < head.length; i++) if (res[j].test(head[i])) return i;
    }
    if (wajib) throw new Error('Kolom "' + wajib + '" tidak ada di laporan Jubelio. Kolom: ' + values[0].join(', '));
    return -1;
  }
  var cNo = col([/^no\.? pesanan$/], 'No Pesanan');
  var cTotal = col([/^grand total$/], 'Grand Total');
  var cTgl = col([/^(tanggal|tgl\.?) (transaksi|pesanan|order)/, /^(tanggal|tgl\.?)$/, /^(tanggal|tgl)/, /date/], 'Tanggal');
  var cLokasi = col([/^lokasi$/, /lokasi|gudang/]);
  var cStatus = col([/^status$/, /status/]);
  var cQty = col([/^(qty|jumlah|kuantitas)$/]);

  var per = {}, urut = [], cancel = {}, tanpaJam = true;
  for (var r = 1; r < values.length; r++) {
    var v = values[r];
    var no = String(v[cNo]).trim();
    if (!no || (JB_CONFIG.PREFIX && no.indexOf(JB_CONFIG.PREFIX) !== 0)) continue;
    if (cStatus >= 0 && /cancel|batal/i.test(String(v[cStatus]))) { cancel[no] = true; continue; }
    var o = per[no];
    if (!o) {
      var waktu = jbWaktu_(v[cTgl]);
      if (!waktu) continue;
      if (Utilities.formatDate(waktu, JB_CONFIG.ZONA, 'HH:mm:ss') !== '00:00:00') tanpaJam = false;
      o = per[no] = {
        no: no,
        waktu: waktu,
        lokasi: cLokasi >= 0 ? String(v[cLokasi]).trim() : '(lokasi)',
        status: cStatus >= 0 ? String(v[cStatus]).trim() : '',
        qty: 0,
        nilai: jbAngka_(v[cTotal]) || 0
      };
      urut.push(no);
    }
    o.qty += cQty >= 0 ? (jbAngka_(v[cQty]) || 0) : 0;
  }
  var order = urut.map(function (no) { return per[no]; })
    .filter(function (o) { return !cancel[o.no]; })
    .sort(function (a, b) { return a.waktu - b.waktu; });
  var perLokasi = {};
  order.forEach(function (o) { perLokasi[o.lokasi] = (perLokasi[o.lokasi] || 0) + 1; });
  return { order: order, cancel: Object.keys(cancel).length, perLokasi: perLokasi, tanpaJam: order.length > 0 && tanpaJam };
}

/** Nilai kolom tanggal laporan → Date (jam WIB), atau null. */
function jbWaktu_(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {
    // nomor seri tanggal Excel (hari sejak 1899-12-30), jam WIB
    return new Date(Math.round((v - 25569) * 86400000) - 7 * 3600000);
  }
  var s = String(v == null ? '' : v).trim();
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/.exec(s);
  var d;
  if (m) d = [m[1], m[2], m[3], m[4], m[5], m[6]];
  m = m || /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ ,]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/.exec(s);
  if (m && !d) d = [m[3], m[2], m[1], m[4], m[5], m[6]];
  if (!d) {
    var t = /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : s + '+07:00';
    var x = new Date(t);
    return isNaN(x) ? null : x;
  }
  var dua = function (n) { n = String(n || 0); return n.length < 2 ? '0' + n : n; };
  return new Date(d[0] + '-' + dua(d[1]) + '-' + dua(d[2]) + 'T' + dua(d[3]) + ':' + dua(d[4]) + ':' + dua(d[5]) + '+07:00');
}

function jbAngka_(s) {
  if (typeof s === 'number') return isFinite(s) ? Math.round(s) : NaN;
  s = String(s == null ? '' : s).trim().replace(/rp\.?/gi, '').replace(/\s/g, '');
  if (!s) return NaN;
  var m = s.match(/^(.*?)[.,](\d{1,2})$/);
  if (m && /^[\d.,]*\d$/.test(m[1])) s = m[1];
  s = s.replace(/[^\d-]/g, '');
  return s ? parseInt(s, 10) : NaN;
}

// ---------------------------------------------------------------------------
// Sesi (aturan sama dengan dashboard)
// ---------------------------------------------------------------------------

function jbMenit_(hhmm) {
  var m = /^(\d{1,2})[:.](\d{2})/.exec(hhmm);
  return Number(m[1]) * 60 + Number(m[2]);
}

function jbJam_(menit) {
  var j = Math.floor(menit / 60), m = menit % 60;
  return (j < 10 ? '0' : '') + j + '.' + (m < 10 ? '0' : '') + m;
}

/** → [{ hari, nomor, key, label, dari, sampai }] dengan potongan memakai buffer. */
function jbSesi_() {
  var out = [];
  Object.keys(JB_CONFIG.SESI).forEach(function (h) {
    var hari = Number(h);
    var geser = JB_CONFIG.BUFFER[hari] || 0;
    var daftar = JB_CONFIG.SESI[h].map(function (r) {
      var p = r.split('-');
      return { mulai: jbMenit_(p[0]), selesai: jbMenit_(p[1]), teks: r.replace(/:/g, '.') };
    }).sort(function (a, b) { return a.mulai - b.mulai; });
    daftar.forEach(function (s, i) {
      var berikut = daftar[i + 1];
      var dari = i === 0 ? s.mulai : s.mulai + geser;
      var sampai = berikut ? Math.min(24 * 60, berikut.mulai + geser) : 24 * 60;
      out.push({
        hari: hari,
        nomor: i + 1,
        key: hari + '-' + (i + 1),
        label: 'Day ' + hari + ' | Sesi ' + (i + 1) + ' (' + s.teks + ')',
        dari: dari,
        sampai: sampai,
        dihitung: jbJam_(dari) + '–' + jbJam_(sampai - 1)
      });
    });
  });
  return out;
}

/** Kunci sesi satu order: "hari-nomor", "hari-0" = di luar sesi, null = di luar event. */
function jbKunciSesi_(waktu, sesi) {
  var tgl = Utilities.formatDate(waktu, JB_CONFIG.ZONA, 'yyyy-MM-dd');
  var jam = Utilities.formatDate(waktu, JB_CONFIG.ZONA, 'HH:mm');
  var hari = Math.round((Date.parse(tgl + 'T00:00:00Z') - Date.parse(JB_CONFIG.DARI + 'T00:00:00Z')) / 86400000) + 1;
  var m = jbMenit_(jam);
  for (var i = 0; i < sesi.length; i++) {
    var s = sesi[i];
    if (s.hari === hari && m >= s.dari && m < s.sampai) return s.key;
  }
  return hari >= 1 ? hari + '-0' : null;
}

/** → { key: { lokasi: {trx, gmv}, total: {trx, gmv} } } */
function jbRingkas_(order, sesi) {
  var hasil = {};
  order.forEach(function (o) {
    var k = jbKunciSesi_(o.waktu, sesi);
    if (!k) return;
    o.sesi = k;
    var r = hasil[k] = hasil[k] || { lokasi: {}, total: { trx: 0, gmv: 0 } };
    var l = r.lokasi[jbNorm_(o.lokasi)] = r.lokasi[jbNorm_(o.lokasi)] || { trx: 0, gmv: 0 };
    l.trx += 1; l.gmv += o.nilai;
    r.total.trx += 1; r.total.gmv += o.nilai;
  });
  return hasil;
}

// ---------------------------------------------------------------------------
// Dashboard (pembanding)
// ---------------------------------------------------------------------------

/** → { key: {trx, gmv} } dari /api/pivot dashboard, atau null. */
function jbDashboard_() {
  if (!JB_CONFIG.DASHBOARD_URL) return null;
  try {
    var res = UrlFetchApp.fetch(JB_CONFIG.DASHBOARD_URL.replace(/\/+$/, '') + '/api/pivot?baris=sesi&segar=1', {
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    var d = JSON.parse(res.getContentText());
    var peta = {};
    (d.rows || []).forEach(function (r) { peta[r.key] = r.total; });
    return peta;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tulis ke Sheet
// ---------------------------------------------------------------------------

/**
 * Spreadsheet laporan terpisah: dibuat sekali, lalu ID-nya disimpan di Script
 * Property JUBELIO_REPORT_ID dan dipakai ulang. Sheet lama tempat script ini
 * terpasang tidak disentuh.
 */
function jbSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('JUBELIO_REPORT_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // file terhapus / tidak bisa dibuka: buat baru
    }
  }
  var ss = SpreadsheetApp.create(JB_CONFIG.NAMA_FILE);
  props.setProperty('JUBELIO_REPORT_ID', ss.getId());
  // lembar bawaan "Sheet1" dipakai untuk laporan, sisanya dibuat sesuai kebutuhan
  ss.getSheets()[0].setName(JB_CONFIG.TAB_REPORT);
  return ss;
}

function jbTab_(nama) {
  var ss = jbSpreadsheet_();
  var sh = ss.getSheetByName(nama) || ss.insertSheet(nama);
  sh.clear();
  return sh;
}

function jbTulisLaporan_(ringkas, sesi, dashboard, order, info) {
  var sh = jbTab_(JB_CONFIG.TAB_REPORT);
  // kolom per lokasi mengikuti nama lokasi yang ada di laporan Jubelio
  var lokasiList = [];
  order.forEach(function (o) { if (lokasiList.indexOf(o.lokasi) < 0) lokasiList.push(o.lokasi); });
  lokasiList.sort();
  var kini = Utilities.formatDate(new Date(), JB_CONFIG.ZONA, 'dd MMM yyyy HH:mm');
  var akhir = order.length
    ? Utilities.formatDate(order[order.length - 1].waktu, JB_CONFIG.ZONA, 'dd MMM HH:mm:ss')
    : '-';
  sh.getRange(1, 1).setValue('Laporan per sesi dari Jubelio (Sales List) · diperbarui ' + kini +
    ' WIB · order terakhir ' + akhir + ' · ' + order.length + ' order');
  sh.getRange(1, 1).setFontWeight('bold');
  if (info && info.tanpaJam) {
    sh.getRange(2, 1).setValue('PERHATIAN: kolom tanggal laporan Jubelio tidak berisi jam, jadi semua pesanan masuk "Di luar sesi".')
      .setFontColor('#d92d20');
  }

  var kepala = ['Sesi', 'Transaksi dihitung'];
  lokasiList.forEach(function (l) { kepala.push('TRX ' + l, 'GMV ' + l); });
  kepala.push('TRX Jubelio', 'GMV Jubelio');
  if (dashboard) kepala.push('TRX Dashboard', 'GMV Dashboard', 'Selisih GMV');

  var baris = [];
  var tambah = function (key, label, dihitung) {
    var r = ringkas[key] || { lokasi: {}, total: { trx: 0, gmv: 0 } };
    var row = [label, dihitung];
    lokasiList.forEach(function (l) {
      var v = r.lokasi[jbNorm_(l)] || { trx: 0, gmv: 0 };
      row.push(v.trx, v.gmv);
    });
    row.push(r.total.trx, r.total.gmv);
    if (dashboard) {
      var d = dashboard[key] || { trx: 0, gmv: 0 };
      row.push(d.trx, d.gmv, r.total.gmv - d.gmv);
    }
    baris.push(row);
  };

  var hariList = [];
  sesi.forEach(function (s) { if (hariList.indexOf(s.hari) < 0) hariList.push(s.hari); });
  hariList.forEach(function (h) {
    var pertama = sesi.filter(function (s) { return s.hari === h; })[0];
    if (ringkas[h + '-0']) tambah(h + '-0', 'Day ' + h + ' | Di luar sesi', '00.00–' + jbJam_(pertama.dari - 1));
    sesi.filter(function (s) { return s.hari === h; }).forEach(function (s) { tambah(s.key, s.label, s.dihitung); });
  });

  // TOTAL
  var total = ['TOTAL', ''];
  for (var c = 2; c < kepala.length; c++) {
    var jml = 0;
    baris.forEach(function (r) { jml += Number(r[c]) || 0; });
    total.push(jml);
  }
  baris.push(total);

  var awal = 3;
  sh.getRange(awal, 1, 1, kepala.length).setValues([kepala]).setFontWeight('bold').setBackground('#ecf3ff');
  sh.getRange(awal + 1, 1, baris.length, kepala.length).setValues(baris);
  sh.getRange(awal + baris.length, 1, 1, kepala.length).setFontWeight('bold').setBackground('#f2f4f7');
  for (var i = 2; i < kepala.length; i++) {
    var f = /^(GMV|Selisih)/.test(kepala[i]) ? '"Rp "#,##0;"-Rp "#,##0' : '#,##0';
    sh.getRange(awal + 1, i + 1, baris.length, 1).setNumberFormat(f);
  }
  sh.setFrozenRows(awal);
  sh.setFrozenColumns(1);

  // Ringkasan per status order Jubelio (mis. untuk melihat order yang belum dibayar)
  var perStatus = {};
  order.forEach(function (o) {
    var s = perStatus[o.status || '(kosong)'] = perStatus[o.status || '(kosong)'] || [0, 0];
    s[0] += 1; s[1] += o.nilai;
  });
  var mulaiStatus = awal + baris.length + 3;
  var tabel = [['Status Jubelio', 'Order', 'GMV']].concat(Object.keys(perStatus).map(function (k) {
    return [k, perStatus[k][0], perStatus[k][1]];
  }));
  sh.getRange(mulaiStatus, 1, tabel.length, 3).setValues(tabel);
  sh.getRange(mulaiStatus, 1, 1, 3).setFontWeight('bold').setBackground('#ecf3ff');
  sh.getRange(mulaiStatus + 1, 3, tabel.length - 1, 1).setNumberFormat('"Rp "#,##0');
  sh.getRange(mulaiStatus + tabel.length + 1, 1).setValue(
    'GMV Jubelio = Grand Total per pesanan (total bayar). GMV Dashboard = total harga barang; selisih kecil bisa karena diskon/promo. ' +
    'Selisih besar di satu sesi biasanya berarti order itu belum masuk database dashboard.'
  ).setFontColor('#667085');
  sh.autoResizeColumns(1, kepala.length);
}

function jbTulisOrder_(order) {
  var sh = jbTab_(JB_CONFIG.TAB_ORDER);
  var data = [['No. pesanan', 'Waktu (WIB)', 'Sesi', 'Lokasi', 'Status', 'Qty', 'Grand Total']];
  order.forEach(function (o) {
    data.push([o.no, Utilities.formatDate(o.waktu, JB_CONFIG.ZONA, 'yyyy-MM-dd HH:mm:ss'), o.sesi || '', o.lokasi, o.status, o.qty, o.nilai]);
  });
  sh.getRange(1, 1, data.length, data[0].length).setValues(data);
  sh.getRange(1, 1, 1, data[0].length).setFontWeight('bold').setBackground('#ecf3ff');
  if (data.length > 1) sh.getRange(2, 7, data.length - 1, 1).setNumberFormat('"Rp "#,##0');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, data[0].length);
}

// ---------------------------------------------------------------------------
// Jadwal otomatis
// ---------------------------------------------------------------------------

/** Jalankan sekali: laporan diperbarui otomatis tiap 15 menit. */
function pasangJadwalJubelio() {
  hapusJadwalJubelio();
  ScriptApp.newTrigger('laporanJubelio').timeBased().everyMinutes(15).create();
}

/** Mematikan pembaruan otomatis. */
function hapusJadwalJubelio() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'laporanJubelio') ScriptApp.deleteTrigger(t);
  });
}

function jbNorm_(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}
