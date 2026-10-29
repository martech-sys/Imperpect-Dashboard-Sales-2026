-- Beberapa baris contoh untuk uji lokal (lihat README, "Uji dengan Postgres lokal").
TRUNCATE laporan_penjualan;
INSERT INTO laporan_penjualan
  (sumber, channel, warehouse, tanggal, waktu, invoice_number, no_order, payment_note, total_bayar, qty, hpp,
   total_harga_barang, brand, sku_produk, name_tag, nama_produk, kategori, warna, ukuran, promo_kode, promo_value, status)
VALUES
  -- invoice 2 produk, 2 brand, sesi 1 hari 1
  ('OFFLINE-STORE', 'IMPERFECT', 'MAIN IMPERFECT WAREHOUS 2026', '2026-10-30', '09:15:00', 'INV-001', 'O-1', 'QRIS EDC BCA', 400000, 1, 60000, 150000, 'HEYMALE', 'HM1', 'BASIC TEE', NULL, 'APPAREL', 'BLACK', 'L', NULL, 0, 'Delivery'),
  ('OFFLINE-STORE', 'IMPERFECT', 'MAIN IMPERFECT WAREHOUS 2026', '2026-10-30', '09:15:00', 'INV-001', 'O-1', 'QRIS EDC BCA', 400000, 1, 100000, 250000, 'HEYLOCAL', 'HL1', '', 'SERA SCARF', 'APPAREL', NULL, NULL, NULL, 0, 'Delivery'),
  -- invoice_number kosong: no_order jadi kuncinya; tebus murah, sesi 2 hari 1
  ('OFFLINE-STORE', 'IMPERFECT', 'TEBUS MURAH IMPERFECT 2026', '2026-10-30', '13:59:59', '  ', 'O-2', 'Cash', 100000, 2, NULL, 100000, 'BOONABOO', 'BB1', 'SERENE KIDS', NULL, 'BAG', NULL, NULL, NULL, 0, 'Delivery'),
  -- batal: tidak dihitung
  ('OFFLINE-STORE', 'IMPERFECT', 'MAIN IMPERFECT WAREHOUS 2026', '2026-10-30', '09:30:00', 'INV-003', 'O-3', 'Cash', 999000, 1, 1, 999000, 'HEYMALE', 'HM1', 'BASIC TEE', NULL, 'APPAREL', NULL, NULL, NULL, 0, 'Cancel'),
  -- di luar sesi hari 2
  ('OFFLINE-STORE', 'IMPERFECT', 'MAIN IMPERFECT WAREHOUS 2026', '2026-10-31', '10:30:00', 'INV-004', 'O-4', 'Debit', 300000, 1, 1, 300000, 'HSC', 'HS1', 'LINEN DRESS', NULL, 'APPAREL', NULL, NULL, NULL, 0, 'Delivery'),
  -- gudang lain dan tanggal di luar event: tidak ikut terbaca
  ('OFFLINE-STORE', 'HEYMALE PIM', 'GUDANG PIM', '2026-10-30', '09:10:00', 'INV-005', 'O-5', 'Cash', 500000, 1, 1, 500000, 'HEYMALE', 'HM1', 'BASIC TEE', NULL, 'APPAREL', NULL, NULL, NULL, 0, 'Delivery'),
  ('OFFLINE-STORE', 'IMPERFECT', 'MAIN IMPERFECT WAREHOUS 2026', '2026-11-02', '09:10:00', 'INV-006', 'O-6', 'Cash', 500000, 1, 1, 500000, 'HEYMALE', 'HM1', 'BASIC TEE', NULL, 'APPAREL', NULL, NULL, NULL, 0, 'Delivery');
