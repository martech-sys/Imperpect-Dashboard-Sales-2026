# Dashboard Penjualan Imperfect Sale 2026

Dashboard penjualan event Imperfect Sale:

| Alamat          | Halaman                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `/ringkasan`    | **Ringkasan All** — internal (warehouse) + eksternal (Sheet brand) digabung, per sumber dan per brand |
| `/`             | **Penjualan per Sesi × Channel** — Unit sold, TRX, dan GMV tiap sesi di setiap channel     |
| `/transactions` | **Rincian Transaksi** — satu baris per produk, dikelompokkan per invoice, dengan ekspor CSV |
| `/eksternal`    | **Ringkasan Eksternal** — penjualan brand eksternal per brand, dari Sheet per brand di Drive |
| `/compare`      | **Compare 2025** — event 2026 (live) vs Imperfect Sale 2025 per hari × sesi, dengan insight |
| `/signin`       | Masuk (hanya bila `DASHBOARD_PASSWORD` diisi)                                             |

- **Tampilan** mengikuti dashboard [OFFLINE-STORE](https://github.com/martech-sys/OFFLINE-STORE):
  template TailAdmin (Tailwind CSS v4 + Alpine.js), sidebar, header, mode terang/gelap, dan tabel
  rincian dengan logika yang sama (nilai tingkat invoice hanya ditulis di baris pertama invoice,
  pencarian, pengurutan, paginasi, ekspor CSV).
- **Pengambilan data** mengikuti [IMPERPECT-SALES-2026](https://github.com/martech-sys/IMPERPECT-SALES-2026):
  query langsung ke tabel `laporan_penjualan` di warehouse `we_data_store`, disaring gudang event
  (`MAIN IMPERFECT WAREHOUS 2026`, `TEBUS MURAH IMPERFECT 2026`) dan tanggal event, paling sering
  sekali per `CACHE_SECONDS`, berapa pun yang membuka dashboard. Tidak ada pipeline snapshot.

```
warehouse (laporan_penjualan) ──1 query / CACHE_SECONDS──► server (Node / Vercel Function)
                                                             │ hitung sesi, pivot, rincian
                                         browser ──/api/*────┘ (muat ulang otomatis tiap ±1 menit)
```

## Halaman Sesi × Channel

Isinya sama dengan tabel sesi yang dipakai selama event:

- **Baris**: Sesi (bawaan), Hari, Brand, atau Jam.
- **Kolom**: tiap channel (bawaan: kolom `warehouse`, jadi satu kolom per gudang event), lalu
  kolom **TOTAL** yang bisa disembunyikan.
- **Filter**: Brand dan Hari. **Urutan kolom channel**: GMV terbesar, Unit sold terbanyak, TRX
  terbanyak, atau nama.
- Kartu KPI di atasnya (GMV, TRX, Unit sold, rata-rata per TRX) mengikuti filter yang sama.
- **Refresh** memuat ulang dari server; halaman juga memuat ulang sendiri tiap
  `max(CACHE_SECONDS, 30)` detik selama tab terbuka. **Export CSV** mengunduh tabel persis seperti
  yang tampil.
- Klik label baris (sesi/hari/brand) untuk membuka rincian transaksinya.
- Titik di bawah judul menunjukkan kesegaran data: hijau = live, oranye = memakai data terakhir
  karena pembacaan terbaru gagal (pesan aslinya ditampilkan) atau mode demo.

### Definisi angka

| Angka         | Dihitung dari                                                                            |
| ------------- | ---------------------------------------------------------------------------------------- |
| **Unit sold** | jumlah `qty`                                                                              |
| **TRX**       | jumlah invoice berbeda (`invoice_number`, atau `no_order` bila kosong)                     |
| **GMV**       | jumlah `total_harga_barang` (nilai per baris produk)                                      |
| **Brand**     | kolom `principal_brand` (per baris produk; kosong = "(tanpa brand)")                       |

- GMV **tidak** memakai `total_bayar`: kolom itu total satu invoice yang berulang di tiap baris
  produknya, jadi menjumlahkannya menghitung invoice berisi tiga produk tiga kali, dan tidak bisa
  dipecah per brand. Ini sama dengan cara OFFLINE-STORE menghitung omzet.
- Invoice yang barangnya jatuh ke beberapa brand/channel dihitung di masing-masing sel, tetapi
  **sekali** di TRX kolom/baris TOTAL. Karena itu TRX TOTAL bisa lebih kecil dari jumlah TRX per
  channel.
- Status `Cancel` dan `Open` tidak dihitung (sama dengan OFFLINE-STORE), di halaman mana pun.

### Sesi

Sesi ditentukan dari kolom `tanggal` dan `waktu`. **Day 1 = `EVENT_DARI`**. Jadwalnya diisi lewat
`EVENT_SESI`, satu hari per baris (atau dipisah `;`):

```
Day 1: 09.00-10.00, 13.00-14.00, 15.00-16.00, 17.00-18.00, 19.00-20.00
Day 2: 09.00-10.00, 11.00-12.00, 13.00-14.00, 15.00-16.00, 17.00-18.00, 19.00-20.00
Day 3: 09.00-10.00, 11.00-12.00, 13.00-14.00, 15.00-16.00, 17.00-18.00, 19.00-20.00
```

- Nomor sesi diberikan otomatis menurut urutan jam: `Day 1 | Sesi 1 (09.00-10.00)`.
- Label sesi mengikuti jadwal tiket, tetapi **transaksi dipotong dari jam mulai sesi sampai jam
  mulai sesi berikutnya** (buffer antrean kasir). Contoh Day 1: Sesi 1 (09.00-10.00) menampung
  transaksi 09.00–12.59, Sesi 2 (13.00-14.00) 13.00–14.59, dan seterusnya. **Sesi terakhir hari
  itu menampung sampai akhir hari.**
- Transaksi sebelum sesi pertama hari itu masuk baris **`Day N | Di luar sesi`**, supaya total
  tabel tetap sama dengan total penjualan event. Baris ini hanya muncul bila ada isinya; sesi
  terjadwal selalu tampil walau masih nol.
- Jadwal yang salah tulis atau rentang yang bertumpuk ditolak saat start, dengan pesan yang
  menyebut barisnya (terlihat di setiap endpoint `/api/*`).

> Jadwal bawaan = jadwal tiket event 2026 (Day 1: 5 sesi, Day 2 dan Day 3: 6 sesi). Ticket A
> (Womens) dan Ticket B (Mens) di sesi yang sama memakai jam yang sama, jadi dihitung satu sesi.
> `EVENT_SESI` hanya perlu diisi kalau jadwalnya berubah.

## Mode uji (mati)

Dashboard membaca gudang & tanggal event 2026. Untuk mengecek tampilan dengan data asli event
lain, isi `UJI_WAREHOUSE` (mis. `MAIN STAGE IMPERFECT SALE 2025`) di Vercel lalu Redeploy:
dashboard membaca **`UJI_LIMIT` (bawaan 20) baris pertama gudang itu** (tanpa batas tanggal,
diurutkan tanggal & jam). Selama mode uji:

- Day 1 = tanggal transaksi pertama di data uji; sesi tetap memakai jadwal 2026, jadi transaksi
  di luar jam itu masuk "Di luar sesi".
- Kolom channel hanya gudang uji. Baris ke-20 bisa memotong satu invoice di tengah.
- Titik status berwarna oranye dengan tulisan "Mode uji · …", dan kartu Event di sidebar
  menyebut gudang ujinya. `/api/health` menampilkan `kesegaran.uji`.

Mode uji tidak mati sendiri: kosongkan (hapus) `UJI_WAREHOUSE` lalu Redeploy untuk kembali ke
event 2026. `UJI_LIMIT` maks. 5000. `PG_QUERY` yang terisi selalu didahulukan dan mematikan mode
uji.

## Halaman Rincian Transaksi

Logikanya mengikuti halaman Transaksi OFFLINE-STORE. Urutan kolom (tabel dan CSV):

| Tabel        | CSV              | Sumber                                       |
| ------------ | ---------------- | -------------------------------------------- |
| Brand        | `brand`          | `principal_brand`                            |
| Tanggal      | `tanggal`        | `tanggal`                                    |
| Jam          | `waktu`          | `waktu`                                      |
| No. invoice  | `invoice`        | `invoice_number` (atau `no_order` bila kosong) |
| SKU          | `sku_produk`     | `sku_produk`                                 |
| Nama produk  | `nama_produk`    | `name_tag` (atau `nama_produk` bila kosong)  |
| Kategori     | `kategori`       | `kategori`                                   |
| Channel      | `channel`        | `warehouse` (atau `channel`, lihat `KOLOM_CHANNEL`) |
| Qty          | `qty`            | `qty`                                        |
| Harga        | `harga`          | `total_harga_barang`                         |
| Promo        | `promo_value`    | `promo_value`                                |
| Total bayar  | `total_bayar`    | `total_bayar`                                |
| Metode bayar | `payment_method` | `payment_note`                               |
| Status       | `status`         | `status`                                     |

HPP tidak dibaca dari warehouse dan tidak ditampilkan di mana pun.

- Satu baris = satu produk. **Total bayar** dan **nilai promo** berlaku untuk satu invoice, jadi
  hanya ditulis di baris pertama invoice itu — dihitung sebelum paginasi, sehingga invoice yang
  terpotong batas halaman tidak menulis totalnya dua kali.
- Tanggal hanya ditulis saat berganti; jam, invoice, channel, promo, total bayar, dan metode bayar
  hanya di baris pertama invoice. Nomor invoice panjang dipendekkan dari tengah (utuhnya di tooltip
  dan CSV).
- Filter Brand, Hari, Sesi, Channel, dan Metode bayar (metode kosong dipilih lewat
  `(tanpa metode bayar)`), plus pencarian (invoice, SKU, nama produk, brand, channel, metode bayar,
  kode promo, kategori). Filter ikut tertulis di alamat halaman, jadi tampilan bisa dibagikan.
- Urutan hanya pada kolom tingkat invoice (tanggal+jam, channel, invoice, brand), supaya baris satu
  invoice tetap berdampingan.
- **Ekspor CSV** memakai filter dan urutan yang sama (pemisah `;`, dengan BOM untuk Excel, maks.
  200.000 baris).

## Ringkasan All

Satu tab untuk seluruh penjualan event: **internal** (warehouse, sama dengan halaman Sesi ×
Channel) ditambah **eksternal** (Sheet brand, sama dengan tab Ringkasan Eksternal).

- **KPI**: GMV total, TRX, Unit sold, jumlah brand yang berjualan.
- **Internal vs Eksternal**: porsi GMV kedua sumber, tabel per sumber (internal dirinci per
  channel/gudang), dan TOTAL. Status tiap sumber ditulis terpisah.
- **Ringkasan per Brand**: seluruh brand dari kedua sumber dengan GMV internal, GMV eksternal, GMV
  total, TRX, unit, dan kontribusi; saring sumber (Semua / Internal / Eksternal / Keduanya), cari,
  dan Export CSV.

Cara menggabungkan:

- Unit sold dan GMV dijumlahkan langsung. TRX gabungan = invoice internal + baris transaksi
  eksternal; satu transaksi tidak boleh dicatat di warehouse **dan** Sheet brand (aturan yang sama
  dengan papan TV), jadi tidak ada yang terhitung dua kali.
- Brand yang namanya sama di `principal_brand` dan di nama file Sheet digabung jadi satu baris
  (sumber "Keduanya"); huruf besar/kecil dan spasi tidak dibedakan.
- Sheet brand yang belum punya transaksi tidak ikut daftar brand.
- Kalau satu sumber gagal dibaca, sumber lainnya tetap tampil dan galatnya disebut di status.

## Compare 2025

Event 2026 (live) dibandingkan dengan Imperfect Sale 2025 (20–23 Nov 2025, Pasaraya Blok M).

- Hari dipasangkan menurut **nama hari** (Jumat vs Jumat, Sabtu vs Sabtu, Minggu vs Minggu), sesi
  menurut **jam mulai**. Kamis 2025 tidak punya pasangan dan hanya ikut "Seluruh event".
- Dasar hitung kedua tahun sama: **GMV = total bayar per invoice** (MAX `total_bayar`, karena
  nilainya berulang di tiap baris produk) — berbeda dengan tab lain yang memakai
  `total_harga_barang`. TRX = jumlah invoice, Unit = jumlah qty, invoice ikut jam baris
  pertamanya, potongan sesi sampai jam mulai sesi berikutnya.
- Angka 2025 tetap di `server/compare.js` (`BASELINE_2025`, hasil query manual channel
  IMPERFECT SALE 2025 + IMPERFECT SALE TEBUS MURAH), jadi tidak menambah beban database.
- Kartu "vs 2025" dan growth berwarna hanya menghitung sesi yang **sudah selesai**; sesi yang sedang
  berjalan ditandai dan disebut terpisah di insight.

## Ringkasan Eksternal

Brand eksternal mencatat penjualannya sendiri di **satu Google Sheet per brand**, di luar
warehouse. Sumbernya sama dengan Sheet brand papan TV IMPERPECT-SALES-2026 (folder Drive yang
sama, file dibuat dengan `scripts/buat-sheet-brand.gs` di repo itu):

- Satu folder Google Drive, satu spreadsheet per brand, **nama file = nama brand**.
- Tab pertama, baris pertama judul, satu baris = satu transaksi:
  `No HP | Nama | qty | trx value`. Kolom dikenali dari judulnya.
- Dibaca dengan **akun layanan** Google (Drive API, `drive.readonly`). Folder di-share sekali ke
  email akun layanan sebagai Viewer; brand hanya memegang file-nya sendiri.
- Tiap pembacaan: 1× daftar isi folder, lalu hanya file yang berubah yang diekspor ulang, paling
  sering sekali per `CACHE_SECONDS`. File yang gagal dibaca tetap memakai isi terakhirnya dan
  ditandai "Gagal dibaca".

Isi tab:

- **KPI**: GMV eksternal, TRX, Unit sold, Brand aktif (brand yang sudah punya transaksi / seluruh
  Sheet di folder).
- **Ringkasan per Brand**: TRX, Unit sold, GMV, Pembeli, rata-rata per TRX, kontribusi, terakhir
  diubah, status (OK / baris dilewati / belum ada transaksi / gagal dibaca), baris TOTAL, pencarian,
  dan Export CSV.
- **Detail Brand** (klik brand atau pilih dari daftar, alamatnya `?brand=…`): KPI brand, nomor baris
  yang dilewati, 10 pembeli teratas, dan seluruh baris transaksinya.

| Angka       | Dihitung dari                                                                 |
| ----------- | ----------------------------------------------------------------------------- |
| **TRX**     | jumlah baris yang `trx value`-nya terbaca dan lebih dari 0                     |
| **Unit**    | jumlah `qty`                                                                  |
| **GMV**     | jumlah `trx value`                                                            |
| **Pembeli** | nomor HP berbeda (TOTAL: berbeda di seluruh brand)                            |

- Baris yang `trx value`-nya kosong/nol/tidak terbaca dilewati dan nomor barisnya ditampilkan.
- Berbeda dengan papan TV, baris **tanpa nomor HP tetap dihitung** sebagai penjualan; hanya tidak
  masuk hitungan pembeli.
- Sheet tidak punya tanggal/jam, jadi tab ini tidak dipecah per hari atau sesi.
- Nomor HP disamarkan (`0812-xxxx-7890`) dan nama dipendekkan (`Dewi L.`) di server; nomor lengkap
  tidak pernah dikirim ke browser.
- Penjualan eksternal **tidak** dijumlahkan ke halaman Sesi × Channel dan Rincian Transaksi.
- Sheet bernama persis **Internal** dilewati, tidak dihitung sebagai brand eksternal. Sheet lain
  yang namanya hanya mengandung kata itu tetap dibaca. Ganti/tambah namanya lewat `DRIVE_EXCLUDE`.

Tanpa `DRIVE_FOLDER`, tab ini menampilkan data contoh (status oranye). Akun layanan yang salah
atau folder yang belum di-share tampil sebagai galat dengan pesan aslinya.

Setup di Vercel (isi yang sama dengan project papan TV kalau sudah ada):

| Variabel                      | Isi                                                                   |
| ----------------------------- | --------------------------------------------------------------------- |
| `DRIVE_FOLDER`                | link atau ID folder Drive berisi Sheet brand                          |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | seluruh isi file key JSON akun layanan, tempel apa adanya (Sensitive) |

| Pesan                                         | Perbaikan                                                       |
| --------------------------------------------- | --------------------------------------------------------------- |
| `Folder Drive tidak bisa dibaca (HTTP 404 …)` | Folder belum di-share ke email akun layanan, atau ID-nya salah. |
| `HTTP 403 … has not been used in project`     | Google Drive API belum diaktifkan di project akun layanan.      |
| `Login akun layanan gagal: invalid_grant`     | Kunci sudah dihapus atau salah tempel; buat key JSON baru.      |
| `GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON …`    | Tempel ulang seluruh isi file, dari `{` sampai `}`.             |
| Brand tidak muncul                            | File harus Google Sheets (bukan `.xlsx`) dan langsung di folder itu. |

## Akses

| `DASHBOARD_PASSWORD` | Akses data                                |
| -------------------- | ----------------------------------------- |
| kosong               | terbuka bagi siapa pun yang memegang link |
| diisi                | hanya setelah masuk dengan password itu   |

Pembatasan ada di server: tanpa login, `/api/pivot`, `/api/transactions`, dan ekspor CSV menjawab
401.

Sesi login disimpan di cookie bertanda tangan HMAC (berlaku 7 hari, tanpa database), jadi berlaku
di semua instance Vercel. Kuncinya diturunkan dari password, sehingga **mengganti password
mengeluarkan semua sesi lama**. Percobaan login dibatasi 8 kali per 10 menit per IP (per instance).

## Cadangan manual (kalau dashboard bermasalah)

- [`scripts/query-manual.sql`](scripts/query-manual.sql) — query SELECT untuk DBeaver/psql dengan
  user read-only, hitungannya sama dengan dashboard: cek data masuk, KPI per gudang, Sesi ×
  Channel (format sama dengan halaman utama), per hari, per brand, per jam, per metode bayar,
  rincian transaksi (urutan kolom halaman Rincian), dan cek satu invoice. Bagian yang bisa diubah
  ditandai `-- UBAH:`. Versi satu baris per query ada di
  [`scripts/query-manual-1baris.sql`](scripts/query-manual-1baris.sql).
- [`scripts/ringkasan-eksternal.gs`](scripts/ringkasan-eksternal.gs) — Apps Script yang membaca
  semua Sheet brand di folder Drive dan menulis ringkasan per brand (TRX, unit, GMV, pembeli,
  status) ke sebuah Google Sheet. Cara pakainya di kepala file.

## Menjalankan

Butuh Node.js 22.

```bash
cp .env.example .env   # isi koneksi database; kosong = mode demo
npm install
npm run build          # membangun frontend ke build/
npm start              # http://localhost:3000
```

Tanpa data koneksi database, dashboard berjalan dalam **mode demo** dengan data contoh (lencana
"Mode demo" di header). Database yang terisi tetapi gagal dibaca **tidak** diganti data contoh:
halaman menampilkan pesan galat aslinya.

| Perintah             | Kegunaan                                      |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | server dengan auto-reload                     |
| `npm run build`      | membangun frontend (development)              |
| `npm run build:prod` | membangun frontend untuk produksi             |
| `npm test`           | tes unit (sesi, agregasi, cache, akses)       |
| `npm run format`     | merapikan kode dengan Prettier                |

### Uji dengan Postgres lokal

`db/schema.sql` dan `db/seed.sql` membuat tabel `laporan_penjualan` tiruan berisi beberapa baris
kasus tepi (invoice dua brand, invoice tanpa nomor, transaksi batal, gudang lain, tanggal di luar
event):

```bash
psql "$DATABASE_URL" -f db/schema.sql -f db/seed.sql
```

Jangan jalankan keduanya di warehouse: `seed.sql` mengosongkan tabel itu.

## Deploy ke Vercel

`vercel.json` sudah siap:

- Build menjalankan `npm test && npm run build:prod`; deploy batal kalau tes gagal.
- Frontend dilayani CDN dari `build/` (alamat tanpa `.html`).
- Seluruh `/api/*` diarahkan ke satu function `api/index.js`, region `sin1` (Singapura).

Langkah:

1. Vercel → **Add New → Project** → impor repo ini. Framework Preset **Other**.
2. **Settings → Environment Variables** (Production):

   | Variabel                                                                                | Nilai                                                                                |
   | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
   | `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` | user read-only warehouse, sama dengan yang dipakai IMPERPECT-SALES-2026 (atau satu `DATABASE_URL`) |
   | `PG_SSL`                                                                                | `false` (atau `true` bila server mewajibkan)                                         |
   | `EVENT_SESI`                                                                            | tidak perlu diisi; bawaan sudah jadwal lengkap Day 1–3                               |
   | `DASHBOARD_PASSWORD`                                                                    | disarankan diisi — tandai **Sensitive**                                              |
   | `CACHE_SECONDS`                                                                         | `60`                                                                                 |

   `EVENT_DARI`, `EVENT_SAMPAI`, `EVENT_WAREHOUSE` sudah berisi bawaan event 2026; isi hanya bila
   berubah.
3. **Deployments → Redeploy** (perubahan env berlaku di deploy berikutnya).
4. Cek `https://<project>.vercel.app/api/health`: `200` dengan `"mode":"postgres"` dan jumlah
   `baris` artinya warehouse terbaca. Bagian `env` menyebut variabel mana yang diterima deploy
   (`terisi`/`kosong`, tanpa nilainya).

Database harus bisa diakses dari internet: Vercel Functions tidak punya IP tetap.

### Cache & kecepatan

Data disimpan di tiga lapis supaya halaman tidak menunggu warehouse atau Google Drive:

| Lapis | Isi | Akibatnya |
| --- | --- | --- |
| **Browser** (localStorage) | jawaban terakhir 15 alamat data | halaman yang dibuka ulang langsung menampilkan angka terakhir ("Menampilkan data tersimpan … memuat data terbaru"), lalu diganti jawaban server. Dikosongkan saat keluar. |
| **CDN Vercel** | jawaban `/api/*` data, `max-age=15`, `stale-while-revalidate=60` | pengunjung lain dan instance yang baru menyala dilayani CDN tanpa menyentuh function. **Hanya bila `DASHBOARD_PASSWORD` kosong** — dengan password, jawaban bergantung pada cookie dan tidak di-cache CDN. Deploy baru mengosongkannya. |
| **Server** (memori function) | hasil query warehouse & isi Sheet | *stale-while-revalidate*: sesudah pembacaan pertama, permintaan tidak pernah menunggu database; data yang lewat `CACHE_SECONDS` langsung dikirim dan pembacaan baru berjalan di belakang (`waitUntil` Vercel). |

Karena tiap tab punya alamat (dan cache) sendiri, dua tab bisa sesaat menampilkan data dari
waktu pembacaan yang berbeda, paling lama sekitar 1–2 menit. Jam pembacaan selalu tertulis di
status. **Tombol Refresh** melewati cache CDN dan meminta server membaca ulang sumbernya bila
datanya lebih tua dari 10 detik, jadi sesudah Refresh angkanya pasti yang terbaru.

Yang masih bisa lambat: permintaan **pertama** sebuah instance yang baru menyala (cold start)
harus menunggu query dan pembacaan Drive. Penyebab terbesarnya biasanya query warehouse yang
memindai seluruh `laporan_penjualan` — lihat index di bawah.

### Beban ke database

- **Satu query per `CACHE_SECONDS` per instance**, berapa pun orang yang membuka dashboard dan
  berapa kali filter diganti: filter, pivot, pencarian, dan paginasi dikerjakan di memori server
  atas hasil query terakhir. Permintaan yang datang bersamaan menunggu satu query yang sama.
- Pool maksimal 1 koneksi per instance Vercel (2 di server Node), koneksi menganggur ditutup setelah
  30 detik, query dibatasi 20 detik (`statement_timeout`).
- Query mengambil baris produk event saja (2 gudang × 3 hari), tanpa kolom pelanggan (`nama`,
  `no_hp`).
- Penyaringnya `warehouse = ANY(...)` dan rentang `tanggal`. Kalau `laporan_penjualan` belum punya
  index `(warehouse, tanggal)`, Postgres memindai tabel tiap query — minta DBA membuatnya, atau
  naikkan `CACHE_SECONDS`. Bagian 6–7 `scripts/cek-event-postgres.sql` di repo IMPERPECT-SALES-2026
  menampilkan index yang ada dan rencana eksekusinya.
- Respons API tidak di-cache CDN (jawabannya bergantung pada cookie login).

Kalau satu pembacaan gagal (DB restart, timeout), dashboard tetap menampilkan data terakhir yang
berhasil, dengan peringatan oranye beserta pesan galatnya. Di Vercel data terakhir itu hanya
bertahan selama instance function masih hangat.

### Kalau gagal

Pesan galat asli tampil di halaman dan di `/api/health` (`kesegaran.error`):

| Pesan                                         | Penyebab dan solusi                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `password authentication failed`              | Password salah. Dengan `DATABASE_URL`: tanda bacanya belum di-encode; pakai variabel terpisah.         |
| `timeout` / `ECONNREFUSED`                    | Host/port salah, atau firewall database menolak IP Vercel.                                             |
| `relation "laporan_penjualan" does not exist` | Tabel di schema lain: isi `DB_SCHEMA`.                                                                 |
| `column "…" does not exist`                   | Kolom di tabel berbeda dari query bawaan: sesuaikan lewat `PG_QUERY` (kolom keluaran harus sama).      |
| `no pg_hba.conf entry ... SSL off`            | Set `PG_SSL=true`.                                                                                     |
| `self-signed certificate`                     | Set juga `PG_SSL_REJECT_UNAUTHORIZED=false`.                                                           |
| `Konfigurasi tidak valid: EVENT_SESI …`       | Jadwal sesi salah tulis; pesannya menyebut baris yang salah.                                           |

## Konfigurasi (`.env`)

| Variabel                          | Bawaan                                                     | Keterangan                                                                                   |
| --------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `EVENT_NAMA`                      | `Imperfect Sale 2026`                                      | Nama di sidebar dan halaman masuk.                                                           |
| `EVENT_DARI`, `EVENT_SAMPAI`      | `2026-10-30`, `2026-11-01`                                 | Rentang tanggal event (WIB). Day 1 = `EVENT_DARI`.                                           |
| `EVENT_DATA_DARI`                 | – (= `EVENT_DARI`)                                         | Opsional, untuk cek transaksi uji: data dibaca mulai tanggal ini; tanggal sebelum `EVENT_DARI` tampil sebagai "Day 0" (seluruhnya di luar sesi). Kosongkan lagi sesudah selesai. |
| `EVENT_WAREHOUSE`                 | `MAIN IMPERFECT WAREHOUS 2026, TEBUS MURAH IMPERFECT 2026` | Gudang event, dipisah koma.                                                                  |
| `KOLOM_CHANNEL`                   | `warehouse`                                                | Kolom yang menjadi kolom channel di tabel: `warehouse` atau `channel`.                       |
| `EVENT_SESI`                      | jadwal tiket Day 1–3                                       | Lihat [Sesi](#sesi).                                                                         |
| `DATABASE_URL` / `DATABASE_HOST`… | –                                                          | Koneksi warehouse. Kosong semua = mode demo.                                                 |
| `PG_SSL`, `PG_SSL_REJECT_UNAUTHORIZED` | `false`, `true`                                       | SSL ke Postgres.                                                                             |
| `DB_SCHEMA`                       | –                                                          | Schema `laporan_penjualan` bila tidak di `search_path`.                                      |
| `PG_QUERY`                        | –                                                          | Ganti seluruh query (tanpa parameter). Kolom keluaran harus sama dengan `server/source-postgres.js`. |
| `CACHE_SECONDS`                   | `60`                                                       | Jarak minimum antar query ke warehouse (min 5).                                              |
| `DASHBOARD_PASSWORD`              | –                                                          | Lihat [Akses](#akses).                                                                       |
| `SESSION_SECRET`                  | –                                                          | Kunci tambahan cookie sesi; mengganti nilainya mengeluarkan semua sesi.                      |
| `UJI_WAREHOUSE`                   | – (mati)                                                   | Gudang [mode uji](#mode-uji-mati). Kosong = baca event 2026.                                 |
| `UJI_LIMIT`                       | `20`                                                       | Jumlah baris mode uji.                                                                       |
| `DRIVE_FOLDER`                    | –                                                          | Folder Sheet brand eksternal. Lihat [Ringkasan Eksternal](#ringkasan-eksternal).            |
| `GOOGLE_SERVICE_ACCOUNT_JSON`     | –                                                          | Key JSON akun layanan (atau `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`).          |
| `DRIVE_MAX_ROWS`                  | `5000`                                                     | Baris maksimum yang dibaca per Sheet brand.                                                  |
| `DRIVE_EXCLUDE`                   | `internal`                                                 | Nama Sheet yang tidak dibaca, harus persis (pisah koma, huruf besar/kecil sama).             |
| `DEMO_MODE`                       | `false`                                                    | Paksa data contoh walau database terisi.                                                     |
| `PORT`                            | `3000`                                                     | Port server lokal.                                                                           |

## Endpoint

| Endpoint                     | Isi                                                                     |
| ---------------------------- | ----------------------------------------------------------------------- |
| `GET /api/app`               | info event, mode data, status login                                     |
| `GET /api/pivot`             | tabel pivot + KPI. Parameter: `brand`, `hari`, `baris`, `urut`           |
| `GET /api/transactions`      | rincian. Parameter: `brand`, `hari`, `sesi`, `channel`, `payment`, `q`, `page`, `pageSize`, `sortBy`, `sortDir` |
| `GET /api/transactions.csv`  | ekspor rincian dengan filter yang sama                                  |
| `GET /api/ringkasan`         | gabungan internal + eksternal: total, per sumber, per brand             |
| `GET /api/compare`           | 2026 vs Imperfect Sale 2025 per hari × sesi + insight                   |
| `GET /api/eksternal`         | ringkasan brand eksternal + KPI                                         |
| `GET /api/eksternal/brand`   | detail satu brand eksternal. Parameter: `brand`                         |
| `GET /api/health`            | kesegaran data dan variabel yang terisi, tanpa isi transaksi            |
| `POST /api/auth/login`       | `{ "password": "…" }`                                                    |
| `POST /api/auth/logout`      |                                                                         |

## Struktur proyek

```
server/
  config.js           environment variable → konfigurasi
  sesi.js             jadwal sesi dan penentuan sesi tiap transaksi
  source-postgres.js  query ke laporan_penjualan (cara IMPERPECT-SALES-2026)
  demo-data.js        data contoh untuk mode demo
  store.js            cache per CACHE_SECONDS, data terakhir saat gagal, buang Cancel/Open
  report.js           pivot Sesi × Channel, rincian, CSV, pilihan filter
  auth.js             gerbang password opsional (cookie HMAC)
  eksternal/          brand eksternal: baca folder Drive, parsing Sheet, ringkasan
  ringkasan.js        gabungan internal + eksternal (tab Ringkasan All)
  app.js              endpoint /api/*
  index.js            server Node lokal (API + berkas build/)
api/index.js          entrypoint Vercel
frontend/             template TailAdmin (dari OFFLINE-STORE)
  partials/           header, sidebar, preloader
  js/pages/           pivot.js, transactions.js, signin.js
scripts/              query & Apps Script cadangan manual
db/                   tabel tiruan untuk uji lokal
test/                 node --test
```

## Catatan

- Template TailAdmin berlisensi MIT; salinannya di [`LICENSE-TAILADMIN`](LICENSE-TAILADMIN).
