# Dashboard Penjualan Imperfect Sale 2026

Dashboard penjualan event Imperfect Sale, dua halaman:

| Alamat          | Halaman                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `/`             | **Penjualan per Sesi × Channel** — Unit sold, TRX, dan GMV tiap sesi di setiap channel     |
| `/transactions` | **Rincian Transaksi** — satu baris per produk, dikelompokkan per invoice, dengan ekspor CSV |
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
Day 2: 09.00-10.00, 11.00-12.00, 13.00-14.00
```

- Nomor sesi diberikan otomatis menurut urutan jam: `Day 1 | Sesi 1 (09.00-10.00)`.
- Batas: jam mulai termasuk, jam selesai tidak (transaksi 10.00 tepat sudah bukan sesi 09.00-10.00).
- Transaksi di luar semua rentang hari itu masuk baris **`Day N | Di luar sesi`**, supaya total
  tabel tetap sama dengan total penjualan event. Baris ini hanya muncul bila ada isinya; sesi
  terjadwal selalu tampil walau masih nol.
- Jadwal yang salah tulis atau rentang yang bertumpuk ditolak saat start, dengan pesan yang
  menyebut barisnya (terlihat di setiap endpoint `/api/*`).

> Jadwal bawaan diambil dari tabel sesi Day 1–Day 2. **Day 3 (1 Nov) belum punya jadwal**, jadi
> seluruh transaksinya masuk "Day 3 | Di luar sesi" sampai `EVENT_SESI` diberi baris `Day 3: …`.

## Halaman Rincian Transaksi

Logikanya mengikuti halaman Transaksi OFFLINE-STORE:

- Satu baris = satu produk. **Total bayar** dan **nilai promo** berlaku untuk satu invoice, jadi
  hanya ditulis di baris pertama invoice itu — dihitung sebelum paginasi, sehingga invoice yang
  terpotong batas halaman tidak menulis totalnya dua kali.
- Tanggal dan channel hanya ditulis saat berganti; nomor invoice panjang dipendekkan dari tengah
  (utuhnya di tooltip dan CSV).
- Filter Brand, Hari, Sesi, Channel, plus pencarian (invoice, SKU, nama produk, brand, channel,
  metode bayar, kode promo, kategori). Filter ikut tertulis di alamat halaman, jadi tampilan bisa
  dibagikan.
- Urutan hanya pada kolom tingkat invoice (tanggal+jam, channel, invoice, brand), supaya baris satu
  invoice tetap berdampingan.
- **Ekspor CSV** memakai filter dan urutan yang sama (pemisah `;`, dengan BOM untuk Excel, maks.
  200.000 baris).

## Akses dan HPP

| `DASHBOARD_PASSWORD` | Akses data                                | Kolom HPP                    |
| -------------------- | ----------------------------------------- | ---------------------------- |
| kosong               | terbuka bagi siapa pun yang memegang link | **tidak pernah dikirim**     |
| diisi                | hanya setelah masuk dengan password itu   | tampil di tabel dan CSV      |

Pembatasan ada di server: tanpa login, `/api/pivot`, `/api/transactions`, dan ekspor CSV menjawab
401, dan HPP tidak ikut dalam JSON maupun CSV — bukan sekadar disembunyikan di tampilan.

Sesi login disimpan di cookie bertanda tangan HMAC (berlaku 7 hari, tanpa database), jadi berlaku
di semua instance Vercel. Kuncinya diturunkan dari password, sehingga **mengganti password
mengeluarkan semua sesi lama**. Percobaan login dibatasi 8 kali per 10 menit per IP (per instance).

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
   | `EVENT_SESI`                                                                            | jadwal sesi lengkap, termasuk Day 3                                                  |
   | `DASHBOARD_PASSWORD`                                                                    | disarankan diisi — tandai **Sensitive**                                              |
   | `CACHE_SECONDS`                                                                         | `60`                                                                                 |

   `EVENT_DARI`, `EVENT_SAMPAI`, `EVENT_WAREHOUSE` sudah berisi bawaan event 2026; isi hanya bila
   berubah.
3. **Deployments → Redeploy** (perubahan env berlaku di deploy berikutnya).
4. Cek `https://<project>.vercel.app/api/health`: `200` dengan `"mode":"postgres"` dan jumlah
   `baris` artinya warehouse terbaca. Bagian `env` menyebut variabel mana yang diterima deploy
   (`terisi`/`kosong`, tanpa nilainya).

Database harus bisa diakses dari internet: Vercel Functions tidak punya IP tetap.

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
| `EVENT_WAREHOUSE`                 | `MAIN IMPERFECT WAREHOUS 2026, TEBUS MURAH IMPERFECT 2026` | Gudang event, dipisah koma.                                                                  |
| `KOLOM_CHANNEL`                   | `warehouse`                                                | Kolom yang menjadi kolom channel di tabel: `warehouse` atau `channel`.                       |
| `EVENT_SESI`                      | jadwal Day 1–2                                             | Lihat [Sesi](#sesi).                                                                         |
| `DATABASE_URL` / `DATABASE_HOST`… | –                                                          | Koneksi warehouse. Kosong semua = mode demo.                                                 |
| `PG_SSL`, `PG_SSL_REJECT_UNAUTHORIZED` | `false`, `true`                                       | SSL ke Postgres.                                                                             |
| `DB_SCHEMA`                       | –                                                          | Schema `laporan_penjualan` bila tidak di `search_path`.                                      |
| `PG_QUERY`                        | –                                                          | Ganti seluruh query (tanpa parameter). Kolom keluaran harus sama dengan `server/source-postgres.js`. |
| `CACHE_SECONDS`                   | `60`                                                       | Jarak minimum antar query ke warehouse (min 5).                                              |
| `DASHBOARD_PASSWORD`              | –                                                          | Lihat [Akses dan HPP](#akses-dan-hpp).                                                       |
| `SESSION_SECRET`                  | –                                                          | Kunci tambahan cookie sesi; mengganti nilainya mengeluarkan semua sesi.                      |
| `DEMO_MODE`                       | `false`                                                    | Paksa data contoh walau database terisi.                                                     |
| `PORT`                            | `3000`                                                     | Port server lokal.                                                                           |

## Endpoint

| Endpoint                     | Isi                                                                     |
| ---------------------------- | ----------------------------------------------------------------------- |
| `GET /api/app`               | info event, mode data, status login                                     |
| `GET /api/pivot`             | tabel pivot + KPI. Parameter: `brand`, `hari`, `baris`, `urut`           |
| `GET /api/transactions`      | rincian. Parameter: `brand`, `hari`, `sesi`, `channel`, `q`, `page`, `pageSize`, `sortBy`, `sortDir` |
| `GET /api/transactions.csv`  | ekspor rincian dengan filter yang sama                                  |
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
  app.js              endpoint /api/*
  index.js            server Node lokal (API + berkas build/)
api/index.js          entrypoint Vercel
frontend/             template TailAdmin (dari OFFLINE-STORE)
  partials/           header, sidebar, preloader
  js/pages/           pivot.js, transactions.js, signin.js
db/                   tabel tiruan untuk uji lokal
test/                 node --test
```

## Catatan

- Template TailAdmin berlisensi MIT; salinannya di [`LICENSE-TAILADMIN`](LICENSE-TAILADMIN).
