import { api } from "../api.js";
import {
  formatAngka,
  formatJam,
  formatPersen,
  formatRupiah,
  formatRupiahRingkas,
} from "../format.js";
import { compose } from "../compose.js";
import { pageBase } from "../page-base.js";

const SUMBER = [
  { value: "", label: "Semua" },
  { value: "internal", label: "Internal" },
  { value: "eksternal", label: "Eksternal" },
  { value: "keduanya", label: "Keduanya" },
];

const LABEL_SUMBER = {
  internal: {
    teks: "Internal",
    kelas:
      "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400",
  },
  eksternal: {
    teks: "Eksternal",
    kelas:
      "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400",
  },
  keduanya: {
    teks: "Keduanya",
    kelas:
      "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
  },
};

/** Tab Ringkasan All: internal (warehouse) + eksternal (Sheet brand). */
export function ringkasanPage() {
  return compose(
    pageBase({
      page: "ringkasan",
      pageTitle: "Ringkasan All",
      pageSubtitle:
        "Penjualan internal (warehouse) dan eksternal (Sheet brand) digabung",
    }),
    {
      data: {
        total: { qty: 0, trx: 0, gmv: 0, aov: 0, brand: 0 },
        internal: null,
        eksternal: null,
        brands: [],
        kesegaran: {},
        galat: {},
      },
      cari: "",
      sumber: "",
      pilihanSumber: SUMBER,

      formatAngka,
      formatPersen,
      formatRupiah,
      formatRupiahRingkas,

      labelSumber: (s) => LABEL_SUMBER[s] || LABEL_SUMBER.internal,

      get kpi() {
        const t = this.data.total;
        return [
          {
            label: "GMV total",
            nilai: formatRupiahRingkas(t.gmv),
            penuh: formatRupiah(t.gmv),
          },
          {
            label: "Transaksi (TRX)",
            nilai: formatAngka(t.trx),
            penuh: "Invoice internal + baris transaksi eksternal",
          },
          {
            label: "Unit sold",
            nilai: formatAngka(t.qty),
            penuh: `${formatAngka(t.qty)} unit`,
          },
          {
            label: "Brand berjualan",
            nilai: formatAngka(t.brand),
            penuh: "Brand dengan penjualan di salah satu sumber",
          },
        ];
      },

      /** Status tiap sumber, ditulis terpisah karena keduanya bisa berbeda nasib. */
      statusSumber(nama) {
        const k = this.data.kesegaran?.[nama];
        const galat = this.data.galat?.[nama];
        if (galat)
          return { warna: "bg-error-500", teks: `gagal dibaca: ${galat}` };
        if (!k) return { warna: "bg-gray-400", teks: "memuat…" };
        const jam = k.fetchedAt ? formatJam(new Date(k.fetchedAt)) : "";
        if (k.stale)
          return {
            warna: "bg-warning-500",
            teks: `data pukul ${jam} (pembacaan terbaru gagal: ${k.error})`,
          };
        if (k.uji)
          return {
            warna: "bg-warning-500",
            teks: `mode uji (${k.uji.limit} baris ${k.uji.warehouse})`,
          };
        if (k.sumber === "demo")
          return { warna: "bg-warning-500", teks: "data contoh" };
        return { warna: "bg-success-500", teks: `live · pukul ${jam}` };
      },

      get brandTampil() {
        const q = this.cari.trim().toLowerCase();
        return this.data.brands.filter(
          (b) =>
            (!this.sumber || b.sumber === this.sumber) &&
            (!q || b.brand.toLowerCase().includes(q)),
        );
      },

      get adaFilter() {
        return Boolean(this.sumber || this.cari.trim());
      },

      async loadData(muatan) {
        const data = await api.ringkasan();
        if (this.usang(muatan)) return;
        this.data = data;
        this.kesegaran = data.kesegaran.internal;
      },

      /** Mengunduh ringkasan per brand persis seperti yang tampil. */
      exportCsv() {
        const sel = (v) => {
          const t = String(v ?? "");
          return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        };
        const kepala = [
          "brand",
          "sumber",
          "trx",
          "unit",
          "gmv_internal",
          "gmv_eksternal",
          "gmv_total",
          "kontribusi_persen",
        ];
        const baris = this.brandTampil.map((b) => [
          b.brand,
          b.sumber,
          b.trx,
          b.qty,
          b.gmvInternal,
          b.gmvEksternal,
          b.gmv,
          b.kontribusi.toFixed(2),
        ]);
        const isi = [kepala, ...baris]
          .map((r) => r.map(sel).join(";"))
          .join("\n");
        const blob = new Blob([`﻿${isi}`], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "ringkasan-all-per-brand.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      },
    },
  );
}
