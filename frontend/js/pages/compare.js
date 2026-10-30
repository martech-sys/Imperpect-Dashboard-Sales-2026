import { api } from "../api.js";
import {
  formatAngka,
  formatDelta,
  formatPersen,
  formatRupiah,
  formatRupiahRingkas,
  formatTanggalSedang,
} from "../format.js";
import { compose } from "../compose.js";
import { pageBase } from "../page-base.js";

const STATUS = {
  selesai: {
    teks: "Selesai",
    kelas: "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-400",
  },
  berjalan: {
    teks: "Berjalan",
    kelas:
      "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
  },
  belum: {
    teks: "Belum",
    kelas: "bg-gray-50 text-gray-400 dark:bg-white/3 dark:text-gray-500",
  },
  "tanpa-pasangan": {
    teks: "Hanya 2025",
    kelas: "bg-gray-50 text-gray-500 dark:bg-white/3 dark:text-gray-400",
  },
  "tanpa-sesi": {
    teks: "Tidak ada sesi",
    kelas: "bg-gray-50 text-gray-400 dark:bg-white/3 dark:text-gray-500",
  },
};

const KOSONG = { unit: 0, trx: 0, gmv: 0 };

/** Tab Compare 2025: event 2026 (live) vs Imperfect Sale 2025 per hari × sesi. */
export function comparePage() {
  return compose(
    pageBase({
      page: "compare",
      pageTitle: "Compare 2025",
      pageSubtitle: "Imperfect Sale 2026 vs 2025 per hari × sesi",
    }),
    {
      data: {
        hari: [],
        tanpaPasangan: [],
        sampaiKini: { v25: KOSONG, v26: KOSONG, sesi: 0 },
        ringkas: {
          v26: KOSONG,
          v25Pasangan: KOSONG,
          v25Semua: KOSONG,
          progresPasangan: 0,
          progresSemua: 0,
        },
        insight: [],
      },

      formatAngka,
      formatPersen,
      formatRupiah,
      formatRupiahRingkas,
      formatTanggalSedang,

      status: (s) => STATUS[s] || STATUS.belum,

      /** Teks pertumbuhan; null = tahun lalu kosong, tidak bisa dibandingkan. */
      growth: (g) => (g === null || g === undefined ? "–" : formatDelta(g)),

      warnaGrowth(g) {
        if (g === null || g === undefined) return "text-gray-400";
        return g >= 0
          ? "text-success-600 dark:text-success-500"
          : "text-error-600 dark:text-error-500";
      },

      get kpi() {
        const s = this.data.sampaiKini;
        const r = this.data.ringkas;
        return [
          {
            label: "GMV 2026 (live)",
            nilai: formatRupiahRingkas(r.v26.gmv),
            penuh: formatRupiah(r.v26.gmv),
            sub: `${formatPersen(r.progresPasangan)} dari Jumat–Minggu 2025`,
            progres: r.progresPasangan,
          },
          {
            label: "GMV sesi selesai vs 2025",
            nilai: this.growth(s.growthGmv),
            warna: this.warnaGrowth(s.growthGmv),
            penuh: `${formatRupiah(s.v26.gmv)} vs ${formatRupiah(s.v25.gmv)}`,
            sub: `${formatRupiahRingkas(s.v26.gmv)} vs ${formatRupiahRingkas(s.v25.gmv)} · ${s.sesi} sesi`,
          },
          {
            label: "TRX sesi selesai vs 2025",
            nilai: this.growth(s.growthTrx),
            warna: this.warnaGrowth(s.growthTrx),
            penuh: `${formatAngka(s.v26.trx)} vs ${formatAngka(s.v25.trx)} invoice`,
            sub: `${formatAngka(s.v26.trx)} vs ${formatAngka(s.v25.trx)} TRX`,
          },
          {
            label: "Rata-rata / TRX vs 2025",
            nilai: this.growth(s.growthAov),
            warna: this.warnaGrowth(s.growthAov),
            penuh: `${formatRupiah(s.aov26)} vs ${formatRupiah(s.aov25)}`,
            sub: `${formatRupiahRingkas(s.aov26 || 0)} vs ${formatRupiahRingkas(s.aov25 || 0)}`,
          },
        ];
      },

      /**
       * Kartu rincian per sesi: hari 2025 tanpa pasangan (Kamis) lebih dulu,
       * mengikuti urutan event 2025, lalu hari-hari 2026.
       */
      get hariRincian() {
        const tanpa = (this.data.tanpaPasangan || []).map((t) => ({
          ...t,
          kunci: `t-${t.tanggal2025}`,
          hari: null,
          tanggal2026: null,
          status: "tanpa-pasangan",
          tanpa: true,
          v26: KOSONG,
          aov26: 0,
          growthGmv: null,
          sesi: t.sesi || [],
        }));
        return [
          ...tanpa,
          ...this.data.hari.map((h) => ({ ...h, kunci: `d-${h.hari}` })),
        ];
      },

      /** Kolom 2026 hanya terisi untuk potongan yang sudah dimulai. */
      ada26: (r) => r.status !== "belum" && r.status !== "tanpa-pasangan",

      /** Skala batang: GMV sesi terbesar dari kedua tahun. */
      get gmvMaks() {
        let maks = 0;
        this.hariRincian.forEach((h) =>
          h.sesi.forEach((r) => {
            maks = Math.max(maks, r.v25.gmv, r.v26.gmv);
          }),
        );
        return maks || 1;
      },

      lebar(nilai) {
        return `${Math.min(100, (nilai / this.gmvMaks) * 100)}%`;
      },

      judulHari(h) {
        if (h.tanpa)
          return `${h.nama} · ${formatTanggalSedang(h.tanggal2025)} (hanya 2025)`;
        return `${h.nama} · ${formatTanggalSedang(h.tanggal2026)} vs ${h.tanggal2025 ? formatTanggalSedang(h.tanggal2025) : "–"}`;
      },

      subJudulHari(h) {
        const n = h.sesi.filter(
          (r) => !r.luarSesi && (h.tanpa ? r.sesi2025 : r.sesi2026),
        ).length;
        return h.tanpa
          ? `Day 1 2025 · ${n} sesi · tidak ada di jadwal 2026`
          : `Day ${h.hari} 2026 · ${n} sesi`;
      },

      async loadData(muatan) {
        const terapkan = (data) => {
          this.data = data;
          this.kesegaran = data.kesegaran;
        };
        const data = await api.compare(
          this.dariCacheUntuk(muatan, terapkan),
          this.muatSegar,
        );
        if (this.usang(muatan)) return;
        terapkan(data);
      },

      /** Mengunduh tabel per sesi kedua tahun. */
      exportCsv() {
        const kepala = [
          "hari",
          "tanggal_2025",
          "tanggal_2026",
          "jam",
          "sesi_2025",
          "sesi_2026",
          "status",
          "unit_2025",
          "unit_2026",
          "trx_2025",
          "trx_2026",
          "gmv_2025",
          "gmv_2026",
          "growth_gmv_persen",
          "aov_2025",
          "aov_2026",
        ];
        const baris = this.hariRincian.flatMap((h) =>
          h.sesi.map((r) => [
            h.nama,
            h.tanggal2025 || "",
            h.tanggal2026 || "",
            r.jam,
            r.sesi2025 || "",
            r.sesi2026 || "",
            r.status,
            r.v25.unit,
            r.v26.unit,
            r.v25.trx,
            r.v26.trx,
            r.v25.gmv,
            r.v26.gmv,
            r.growthGmv === null ? "" : r.growthGmv.toFixed(1),
            r.aov25,
            r.aov26,
          ]),
        );
        const isi = [kepala, ...baris].map((r) => r.join(";")).join("\n");
        const blob = new Blob([`﻿${isi}`], {
          type: "text/csv;charset=utf-8",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "compare-2025-vs-2026.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      },
    },
  );
}
