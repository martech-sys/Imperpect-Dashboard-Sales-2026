/**
 * Laporan per sesi langsung dari API Jubelio — pembanding dashboard.
 *
 * Membaca order event dari Jubelio (cara yang sama dengan sumber Jubelio di
 * papan TV IMPERPECT-SALES-2026: POST /login, lalu GET /sales/orders/ per
 * halaman), lalu menulis dua tab di spreadsheet tempat script ini dipasang:
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
 *   1. Buat Google Sheet baru → Extensions → Apps Script, tempel file ini.
 *   2. Project Settings → Script Properties, tambahkan:
 *        JUBELIO_EMAIL     email login API Jubelio
 *        JUBELIO_PASSWORD  password-nya
 *      (jangan ditulis di kode).
 *   3. Isi DASHBOARD_URL di bawah (alamat dashboard Vercel) bila ingin kolom
 *      pembanding dashboard.
 *   4. Pilih fungsi laporanJubelio → Run → izinkan akses.
 *   5. Opsional: jalankan pasangJadwal sekali → laporan diperbarui tiap 15
 *      menit. Matikan dengan hapusJadwal. Menu "Jubelio" juga muncul di Sheet.
 */

var CONFIG = {
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
  TAB_REPORT: 'Jubelio per Sesi',
  TAB_ORDER: 'Jubelio Order',
  ZONA: 'Asia/Jakarta'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Jubelio')
    .addItem('Perbarui laporan per sesi', 'laporanJubelio')
    .addToUi();
}

function laporanJubelio() {
  var order = ambilOrderJubelio_();
  var sesi = daftarSesi_();
  var ringkas = ringkasPerSesi_(order, sesi);
  var dashboard = ambilDashboard_();
  tulisLaporan_(ringkas, sesi, dashboard, order);
  tulisOrder_(order);
}

// ---------------------------------------------------------------------------
// Jubelio
// ---------------------------------------------------------------------------

function loginJubelio_() {
  var p = PropertiesService.getScriptProperties();
  var email = p.getProperty('JUBELIO_EMAIL');
  var password = p.getProperty('JUBELIO_PASSWORD');
  if (!email || !password) {
    throw new Error('Isi Script Properties JUBELIO_EMAIL dan JUBELIO_PASSWORD dulu (Project Settings).');
  }
  var res = UrlFetchApp.fetch(CONFIG.API + '/login', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ email: email, password: password }),
    muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !body.token) {
    throw new Error('Login Jubelio gagal: HTTP ' + res.getResponseCode());
  }
  return body.token; // dipakai apa adanya di header Authorization, tanpa "Bearer"
}

/** → [{ no, waktu (Date), lokasi, status, nilai }] order event di gudang CONFIG.LOKASI. */
function ambilOrderJubelio_() {
  var token = loginJubelio_();
  var lokasi = CONFIG.LOKASI.map(norm_);
  var hasil = [];
  var halaman = 1;
  var ukuran = 200;
  while (true) {
    var q = {
      page: halaman,
      pageSize: ukuran,
      sortBy: 'transaction_date',
      sortDirection: 'ASC',
      transactionDateFrom: CONFIG.DARI + 'T00:00:00+07:00',
      transactionDateTo: CONFIG.SAMPAI + 'T23:59:59+07:00'
    };
    var url = CONFIG.API + '/sales/orders/?' + Object.keys(q)
      .map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: token, Accept: 'application/json' },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('Jubelio GET /sales/orders/ halaman ' + halaman + ': HTTP ' + res.getResponseCode());
    }
    var data = (JSON.parse(res.getContentText() || '{}').data) || [];
    data.forEach(function (o) {
      if (lokasi.indexOf(norm_(o.location_name)) < 0) return;
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
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// Sesi (aturan sama dengan dashboard)
// ---------------------------------------------------------------------------

function menit_(hhmm) {
  var m = /^(\d{1,2})[:.](\d{2})/.exec(hhmm);
  return Number(m[1]) * 60 + Number(m[2]);
}

function jamTeks_(menit) {
  var j = Math.floor(menit / 60), m = menit % 60;
  return (j < 10 ? '0' : '') + j + '.' + (m < 10 ? '0' : '') + m;
}

/** → [{ hari, nomor, key, label, dari, sampai }] dengan potongan memakai buffer. */
function daftarSesi_() {
  var out = [];
  Object.keys(CONFIG.SESI).forEach(function (h) {
    var hari = Number(h);
    var geser = CONFIG.BUFFER[hari] || 0;
    var daftar = CONFIG.SESI[h].map(function (r) {
      var p = r.split('-');
      return { mulai: menit_(p[0]), selesai: menit_(p[1]), teks: r.replace(/:/g, '.') };
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
        dihitung: jamTeks_(dari) + '–' + jamTeks_(sampai - 1)
      });
    });
  });
  return out;
}

/** Kunci sesi satu order: "hari-nomor", "hari-0" = di luar sesi, null = di luar event. */
function kunciSesi_(waktu, sesi) {
  var tgl = Utilities.formatDate(waktu, CONFIG.ZONA, 'yyyy-MM-dd');
  var jam = Utilities.formatDate(waktu, CONFIG.ZONA, 'HH:mm');
  var hari = Math.round((Date.parse(tgl + 'T00:00:00Z') - Date.parse(CONFIG.DARI + 'T00:00:00Z')) / 86400000) + 1;
  var m = menit_(jam);
  for (var i = 0; i < sesi.length; i++) {
    var s = sesi[i];
    if (s.hari === hari && m >= s.dari && m < s.sampai) return s.key;
  }
  return hari >= 1 ? hari + '-0' : null;
}

/** → { key: { lokasi: {trx, gmv}, total: {trx, gmv} } } */
function ringkasPerSesi_(order, sesi) {
  var hasil = {};
  order.forEach(function (o) {
    var k = kunciSesi_(o.waktu, sesi);
    if (!k) return;
    o.sesi = k;
    var r = hasil[k] = hasil[k] || { lokasi: {}, total: { trx: 0, gmv: 0 } };
    var l = r.lokasi[norm_(o.lokasi)] = r.lokasi[norm_(o.lokasi)] || { trx: 0, gmv: 0 };
    l.trx += 1; l.gmv += o.nilai;
    r.total.trx += 1; r.total.gmv += o.nilai;
  });
  return hasil;
}

// ---------------------------------------------------------------------------
// Dashboard (pembanding)
// ---------------------------------------------------------------------------

/** → { key: {trx, gmv} } dari /api/pivot dashboard, atau null. */
function ambilDashboard_() {
  if (!CONFIG.DASHBOARD_URL) return null;
  try {
    var res = UrlFetchApp.fetch(CONFIG.DASHBOARD_URL.replace(/\/+$/, '') + '/api/pivot?baris=sesi&segar=1', {
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

function tabBersih_(nama) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(nama) || ss.insertSheet(nama);
  sh.clear();
  return sh;
}

function tulisLaporan_(ringkas, sesi, dashboard, order) {
  var sh = tabBersih_(CONFIG.TAB_REPORT);
  var kini = Utilities.formatDate(new Date(), CONFIG.ZONA, 'dd MMM yyyy HH:mm');
  var akhir = order.length
    ? Utilities.formatDate(order[order.length - 1].waktu, CONFIG.ZONA, 'dd MMM HH:mm:ss')
    : '-';
  sh.getRange(1, 1).setValue('Laporan per sesi dari API Jubelio · diperbarui ' + kini +
    ' WIB · order terakhir ' + akhir + ' · ' + order.length + ' order');
  sh.getRange(1, 1).setFontWeight('bold');

  var kepala = ['Sesi', 'Transaksi dihitung'];
  CONFIG.LOKASI.forEach(function (l) { kepala.push('TRX ' + l, 'GMV ' + l); });
  kepala.push('TRX Jubelio', 'GMV Jubelio');
  if (dashboard) kepala.push('TRX Dashboard', 'GMV Dashboard', 'Selisih GMV');

  var baris = [];
  var tambah = function (key, label, dihitung) {
    var r = ringkas[key] || { lokasi: {}, total: { trx: 0, gmv: 0 } };
    var row = [label, dihitung];
    CONFIG.LOKASI.forEach(function (l) {
      var v = r.lokasi[norm_(l)] || { trx: 0, gmv: 0 };
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
    if (ringkas[h + '-0']) tambah(h + '-0', 'Day ' + h + ' | Di luar sesi', '00.00–' + jamTeks_(pertama.dari - 1));
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

function tulisOrder_(order) {
  var sh = tabBersih_(CONFIG.TAB_ORDER);
  var data = [['No. order', 'Waktu (WIB)', 'Sesi', 'Gudang', 'Status', 'Nilai (grand_total)']];
  order.forEach(function (o) {
    data.push([o.no, Utilities.formatDate(o.waktu, CONFIG.ZONA, 'yyyy-MM-dd HH:mm:ss'), o.sesi || '', o.lokasi, o.status, o.nilai]);
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
function pasangJadwal() {
  hapusJadwal();
  ScriptApp.newTrigger('laporanJubelio').timeBased().everyMinutes(15).create();
}

/** Mematikan pembaruan otomatis. */
function hapusJadwal() {
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

function norm_(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}
