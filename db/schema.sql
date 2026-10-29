-- Tabel contoh untuk uji lokal, meniru kolom laporan_penjualan di warehouse
-- we_data_store yang dipakai dashboard ini. Di produksi tabelnya sudah ada;
-- file ini TIDAK perlu dijalankan di warehouse.
CREATE TABLE IF NOT EXISTS laporan_penjualan (
  sumber             text,
  channel            text,
  warehouse          text,
  tanggal            date,
  waktu              time,
  invoice_number     text,
  no_order           text,
  payment_note       text,
  total_bayar        numeric(18, 4),
  qty                numeric(18, 4),
  hpp                numeric(18, 4),
  total_harga_barang numeric(18, 4),
  brand              text,
  principal_brand    text,
  sku_produk         text,
  name_tag           text,
  nama_produk        text,
  kategori           text,
  warna              text,
  ukuran             text,
  promo_kode         text,
  promo_value        numeric(18, 4),
  status             text,
  nama               text,
  no_hp              text
);
