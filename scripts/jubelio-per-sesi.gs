/**
 * Laporan per sesi langsung dari API Jubelio — pembanding dashboard.
 *
 * Membaca order event dari Jubelio (cara yang sama dengan sumber Jubelio di
 * papan TV IMPERPECT-SALES-2026: POST /login, lalu GET /sales/orders/ per
 * halaman), lalu menulis dua tab di spreadsheet BARU yang dibuat otomatis
 * (link-nya muncul di Execution log; sheet lama tempat script ini terpasang
 * tidak diubah). Nama fungsi & variabel diberi awalan jb/Jubelio supaya tidak
 * bentrok dengan script lain di project yang sama:
 *   - "Jubelio per Sesi": TRX & GMV per Day × Sesi per gudang, plus kolom
 *     dashboard dan selisihnya (bila DASHBOARD_URL diisi).
 *   - "Jubelio Order"   : satu baris per order (no. order, waktu WIB, gudang,
 *     status, nilai) untuk dicek satu per satu.
 *
 * Hitungan:
 *   TRX = jumlah order, GMV = grand_total order (total bayar).
 *   Order batal (internal_status CANCELED / is_canceled) tidak dihitung.
 *   Sesi = aturan yang sama dengan dashboard: jam mulai sesi s/d jam mulai
 *   sesi berikutnya (+ buffer per hari), sesi terakhir s/d akhir hari,
 *   sebelum sesi pertama = "Di luar sesi".
 *
 * Cara pakai:
 *   1. Di project Apps Script yang sudah ada: klik + → Script, beri nama
 *      "jubelio", tempel file ini (jangan menimpa file lain).
 *   2. Project Settings → Script Properties, tambahkan:
 *        JUBELIO_EMAIL     email login API Jubelio
 *        JUBELIO_PASSWORD  password-nya
 *      (jangan ditulis di kode).
 *   3. Isi DASHBOARD_URL di bawah (alamat dashboard Vercel) bila ingin kolom
 *      pembanding dashboard.
 *   4. Pilih fungsi laporanJubelio → Run → izinkan akses. Run pertama membuat
 *      spreadsheet "Laporan Jubelio per Sesi - Imperfect Sale 2026" di Drive;
 *      link-nya ada di Execution log. Run berikutnya menimpa file yang sama.
 *   5. Opsional: jalankan pasangJadwalJubelio sekali → laporan diperbarui tiap
 *      15 menit. Matikan dengan hapusJadwalJubelio.
 */

var JB_CONFIG = {
  API: 'https://api2.jubelio.com',
  // Nama gudang persis seperti di Jubelio (huruf besar/kecil & spasi diabaikan)
  LOKASI: ['MAIN IMPERFECT WAREHOUS 2026', 'TEBUS MURAH IMPERFECT 2026'],
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
  var order = ambilOrderJubelio_();
  var sesi = jbSesi_();
  var ringkas = jbRingkas_(order, sesi);
  var dashboard = jbDashboard_();
  jbTulisLaporan_(ringkas, sesi, dashboard, order);
  jbTulisOrder_(order);
  Logger.log('Laporan: ' + jbSpreadsheet_().getUrl());
}

// ---------------------------------------------------------------------------
// Jubelio
// ---------------------------------------------------------------------------

/**
 * UrlFetch dengan coba ulang saat Jubelio membatasi (HTTP 429) atau sibuk
 * (5xx): tunggu Retry-After bila ada, selain itu 5, 10, 20, 40, 60 detik.
 * Akun Jubelio yang sama dipakai papan TV, jadi batas request bisa terpakai
 * bersama.
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

function loginJubelio_() {
  // token disimpan 6 jam supaya tidak login ulang tiap run (login juga kena batas)
  var cache = CacheService.getScriptCache();
  var simpan = cache.get('jb_token');
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

/** → [{ no, waktu (Date), lokasi, status, nilai }] order event di gudang JB_CONFIG.LOKASI. */
function ambilOrderJubelio_() {
  var token = loginJubelio_();
  var lokasi = JB_CONFIG.LOKASI.map(jbNorm_);
  var hasil = [];
  var halaman = 1;
  var ukuran = 200;
  var ulangLogin = false;
  while (true) {
    var q = {
      page: halaman,
      pageSize: ukuran,
      sortBy: 'transaction_date',
      sortDirection: 'ASC',
      transactionDateFrom: JB_CONFIG.DARI + 'T00:00:00+07:00',
      transactionDateTo: JB_CONFIG.SAMPAI + 'T23:59:59+07:00'
    };
    var url = JB_CONFIG.API + '/sales/orders/?' + Object.keys(q)
      .map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
    var res = jbFetch_(url, {
      headers: { Authorization: token, Accept: 'application/json' },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 401 && !ulangLogin) {
      // token tersimpan kedaluwarsa: login ulang sekali
      CacheService.getScriptCache().remove('jb_token');
      token = loginJubelio_();
      ulangLogin = true;
      continue;
    }
    if (res.getResponseCode() !== 200) {
      throw new Error('Jubelio GET /sales/orders/ halaman ' + halaman + ': HTTP ' + res.getResponseCode());
    }
    var data = (JSON.parse(res.getContentText() || '{}').data) || [];
    data.forEach(function (o) {
      if (lokasi.indexOf(jbNorm_(o.location_name)) < 0) return;
      var batal = o.is_canceled === true || String(o.internal_status || '').toUpperCase() === 'CANCELED';
      if (batal) return;
      var waktu = waktuJubelio_(o.transaction_date || o.created_date);
      if (isNaN(waktu)) return;
      hasil.push({
        no: o.salesorder_no || String(o.salesorder_id),
        waktu: waktu,
        lokasi: o.location_name,
        status: o.internal_status || o.status || '',
        nilai: Math.round(Number(o.grand_total) || 0)
      });
    });
    if (data.length < ukuran) break;
    halaman++;
    Utilities.sleep(1500); // jeda antar halaman supaya tidak kena batas request
  }
  return hasil;
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

function jbTulisLaporan_(ringkas, sesi, dashboard, order) {
  var sh = jbTab_(JB_CONFIG.TAB_REPORT);
  var kini = Utilities.formatDate(new Date(), JB_CONFIG.ZONA, 'dd MMM yyyy HH:mm');
  var akhir = order.length
    ? Utilities.formatDate(order[order.length - 1].waktu, JB_CONFIG.ZONA, 'dd MMM HH:mm:ss')
    : '-';
  sh.getRange(1, 1).setValue('Laporan per sesi dari API Jubelio · diperbarui ' + kini +
    ' WIB · order terakhir ' + akhir + ' · ' + order.length + ' order');
  sh.getRange(1, 1).setFontWeight('bold');

  var kepala = ['Sesi', 'Transaksi dihitung'];
  JB_CONFIG.LOKASI.forEach(function (l) { kepala.push('TRX ' + l, 'GMV ' + l); });
  kepala.push('TRX Jubelio', 'GMV Jubelio');
  if (dashboard) kepala.push('TRX Dashboard', 'GMV Dashboard', 'Selisih GMV');

  var baris = [];
  var tambah = function (key, label, dihitung) {
    var r = ringkas[key] || { lokasi: {}, total: { trx: 0, gmv: 0 } };
    var row = [label, dihitung];
    JB_CONFIG.LOKASI.forEach(function (l) {
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
    'GMV Jubelio = grand_total (total bayar). GMV Dashboard = total harga barang; selisih kecil bisa karena diskon/promo. ' +
    'Selisih besar di satu sesi biasanya berarti order itu belum masuk database dashboard.'
  ).setFontColor('#667085');
  sh.autoResizeColumns(1, kepala.length);
}

function jbTulisOrder_(order) {
  var sh = jbTab_(JB_CONFIG.TAB_ORDER);
  var data = [['No. order', 'Waktu (WIB)', 'Sesi', 'Gudang', 'Status', 'Nilai (grand_total)']];
  order.forEach(function (o) {
    data.push([o.no, Utilities.formatDate(o.waktu, JB_CONFIG.ZONA, 'yyyy-MM-dd HH:mm:ss'), o.sesi || '', o.lokasi, o.status, o.nilai]);
  });
  sh.getRange(1, 1, data.length, data[0].length).setValues(data);
  sh.getRange(1, 1, 1, data[0].length).setFontWeight('bold').setBackground('#ecf3ff');
  if (data.length > 1) sh.getRange(2, 6, data.length - 1, 1).setNumberFormat('"Rp "#,##0');
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

/** Waktu ISO dari Jubelio; tanpa zona waktu dianggap WIB. */
function waktuJubelio_(v) {
  var t = String(v || '');
  if (t && !/(Z|[+-]\d{2}:?\d{2})$/.test(t)) t += '+07:00';
  return new Date(t);
}

function jbNorm_(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}
