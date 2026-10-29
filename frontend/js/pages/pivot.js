import { api, toQuery } from "../api.js";
import { formatAngka, formatRupiah, formatRupiahRingkas } from "../format.js";
import { compose } from "../compose.js";
import { pageBase } from "../page-base.js";

const STORAGE_KEY = "isd.pivot.v1";

const PILIHAN_BARIS = [
  { value: "sesi", label: "Sesi" },
  { value: "hari", label: "Hari" },
  { value: "brand", label: "Brand" },
  { value: "jam", label: "Jam" },
];

const PILIHAN_URUT = [
  { value: "gmv", label: "GMV terbesar" },
  { value: "qty", label: "Unit sold terbanyak" },
  { value: "trx", label: "TRX terbanyak" },
  { value: "nama", label: "Nama A–Z" },
];

const METRIK = [
  { key: "qty", label: "Unit sold" },
  { key: "trx", label: "TRX" },
  { key: "gmv", label: "GMV" },
];

/** Halaman utama: tabel Penjualan per Sesi × Channel. */
export function pivotPage() {
  return compose(
    pageBase({
      page: "pivot",
      pageTitle: "Penjualan per Sesi × Channel",
      pageSubtitle: "Unit sold, transaksi, dan GMV per sesi di tiap channel",
    }),
    {
      brand: "",
      hari: "",
      baris: "sesi",
      urut: "gmv",
      tampilTotal: true,

      pilihanBaris: PILIHAN_BARIS,
      pilihanUrut: PILIHAN_URUT,
      metrik: METRIK,

      data: {
        columns: [],
        rows: [],
        total: { qty: 0, trx: 0, gmv: 0 },
        summary: { qty: 0, trx: 0, gmv: 0, aov: 0 },
        options: { brands: [], hari: [] },
      },

      formatAngka,
      formatRupiah,
      formatRupiahRingkas,

      get labelBaris() {
        return PILIHAN_BARIS.find((p) => p.value === this.baris)?.label || "";
      },

      /** Kolom TOTAL per channel di baris paling bawah. */
      totalKolom(key) {
        return this.data.columns.find((c) => c.key === key) || {};
      },

      /** Tautan dari label baris ke rincian transaksinya. */
      linkBaris(row) {
        if (!row.filter) return null;
        const params = { ...row.filter };
        if (this.brand && !params.brand) params.brand = this.brand;
        if (this.hari && !params.hari && !params.sesi) params.hari = this.hari;
        return `/transactions?${toQuery(params)}`;
      },

      async loadData(muatan) {
        const terapkan = (data) => {
          this.data = data;
          this.kesegaran = data.kesegaran;
        };
        const data = await api.pivot(
          {
            brand: this.brand,
            hari: this.hari,
            baris: this.baris,
            urut: this.urut,
          },
          this.dariCacheUntuk(muatan, terapkan),
        );
        if (this.usang(muatan)) return;
        terapkan(data);
      },

      saveState() {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              brand: this.brand,
              hari: this.hari,
              baris: this.baris,
              urut: this.urut,
              tampilTotal: this.tampilTotal,
            }),
          );
        } catch {
          // Penyimpanan lokal tidak tersedia — pilihan berlaku untuk sesi ini saja.
        }
      },

      restoreState() {
        try {
          const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
          if (!s) return;
          this.brand = s.brand || "";
          this.hari = s.hari || "";
          if (PILIHAN_BARIS.some((p) => p.value === s.baris))
            this.baris = s.baris;
          if (PILIHAN_URUT.some((p) => p.value === s.urut)) this.urut = s.urut;
          this.tampilTotal = s.tampilTotal !== false;
        } catch {
          // Data tersimpan rusak — pakai bawaan.
        }
      },

      /** Mengunduh tabel persis seperti yang tampil (termasuk pilihan kolom TOTAL). */
      exportCsv() {
        const sel = (v) => {
          const t = String(v ?? "");
          return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        };
        const grup = [
          ...this.data.columns.map((c) => c.label),
          ...(this.tampilTotal ? ["TOTAL"] : []),
        ];
        const kepala1 = [this.labelBaris, ...grup.flatMap((g) => [g, "", ""])];
        const kepala2 = ["", ...grup.flatMap(() => METRIK.map((m) => m.label))];
        const nilai = (cells, total) => [
          ...this.data.columns.flatMap((c) =>
            METRIK.map((m) => cells[c.key][m.key]),
          ),
          ...(this.tampilTotal ? METRIK.map((m) => total[m.key]) : []),
        ];
        const baris = this.data.rows.map((r) => [
          r.label,
          ...nilai(r.cells, r.total),
        ]);
        const totalCells = Object.fromEntries(
          this.data.columns.map((c) => [c.key, c]),
        );
        baris.push(["TOTAL", ...nilai(totalCells, this.data.total)]);

        const isi = [kepala1, kepala2, ...baris]
          .map((b) => b.map(sel).join(";"))
          .join("\n");
        const blob = new Blob([`﻿${isi}`], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        const namaFilter = [
          this.baris,
          this.brand,
          this.hari && `day${this.hari}`,
        ]
          .filter(Boolean)
          .join("_");
        a.download = `penjualan-per-${namaFilter}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      },
    },
  );
}
