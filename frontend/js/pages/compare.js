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
        insightTarget: [],
        target: {
          total: 0,
          kategori: [],
          brands: [],
          jumlahSesi: 0,
          sesi: [],
          luarTarget: [],
        },
      },
      /** "" = semua brand target, "k:<kategori>", atau "b:<kunci brand>". */
      targetPilih: "",

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
            label: "GMV Net 2026 (live)",
            nilai: formatRupiahRingkas(r.v26.gmv),
            penuh: formatRupiah(r.v26.gmv),
            sub: `${formatPersen(r.progresPasangan)} dari Jumat–Minggu 2025`,
            progres: r.progresPasangan,
          },
          {
            label: "GMV Net sesi selesai vs 2025",
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

      // ---------------------------------------------------------------
      // Target
      // ---------------------------------------------------------------

      get opsiTarget() {
        const t = this.data.target;
        return [
          { value: "", label: "Semua brand target" },
          ...t.kategori.map((k) => ({
            value: `k:${k.nama}`,
            label: `${k.nama} (semua brand)`,
          })),
          ...t.brands.map((b) => ({
            value: `b:${b.kunci}`,
            label: `${b.brand} · ${b.kategori}`,
          })),
        ];
      },

      get brandTerpilih() {
        const p = this.targetPilih;
        const semua = this.data.target.brands;
        if (p.startsWith("k:"))
          return semua.filter((b) => b.kategori === p.slice(2));
        if (p.startsWith("b:"))
          return semua.filter((b) => b.kunci === p.slice(2));
        return semua;
      },

      get targetTerpilih() {
        return this.brandTerpilih.reduce((a, b) => a + b.target, 0);
      },

      /** Baris per sesi untuk pilihan target saat ini. */
      get targetSesi() {
        const t = this.data.target;
        const total = this.targetTerpilih;
        const kunci = this.brandTerpilih.map((b) => b.kunci);
        const rata = t.jumlahSesi ? total / t.jumlahSesi : 0;
        return t.sesi.map((s) => {
          const aktual = kunci.reduce((a, k) => a + (s.aktual[k] || 0), 0);
          const prop = total * s.bobot;
          return {
            ...s,
            rata,
            prop,
            aktual,
            capaiRata: rata ? (aktual / rata) * 100 : null,
            capaiProp: prop ? (aktual / prop) * 100 : null,
          };
        });
      },

      /** targetSesi dikelompokkan per hari, dengan subtotal. */
      get targetPerHari() {
        const grup = [];
        this.targetSesi.forEach((s) => {
          let g = grup.find((x) => x.hari === s.hari);
          if (!g) {
            g = {
              hari: s.hari,
              nama: s.nama,
              sesi: [],
              rata: 0,
              prop: 0,
              aktual: 0,
            };
            grup.push(g);
          }
          g.sesi.push(s);
          g.rata += s.rata;
          g.prop += s.prop;
          g.aktual += s.aktual;
        });
        return grup;
      },

      get targetAktual() {
        return this.brandTerpilih.reduce((a, b) => a + b.aktual, 0);
      },

      get targetKpi() {
        const total = this.targetTerpilih;
        const aktual = this.targetAktual;
        const selesai = this.targetSesi.filter((s) => s.status === "selesai");
        const aktSelesai = selesai.reduce((a, s) => a + s.aktual, 0);
        const propSelesai = selesai.reduce((a, s) => a + s.prop, 0);
        return [
          {
            label: "Target",
            nilai: formatRupiahRingkas(total),
            penuh: formatRupiah(total),
          },
          {
            label: "Aktual GMV Net",
            nilai: formatRupiahRingkas(aktual),
            penuh: formatRupiah(aktual),
            sub: total
              ? `${formatPersen((aktual / total) * 100)} dari target`
              : "",
            progres: total ? (aktual / total) * 100 : 0,
          },
          {
            label: "Sesi selesai vs target proporsional",
            nilai: propSelesai
              ? formatPersen((aktSelesai / propSelesai) * 100)
              : "–",
            warna: propSelesai
              ? aktSelesai >= propSelesai
                ? "text-success-600 dark:text-success-500"
                : "text-error-600 dark:text-error-500"
              : "",
            sub: `${formatRupiahRingkas(aktSelesai)} vs ${formatRupiahRingkas(propSelesai)} · ${selesai.length} sesi`,
          },
          {
            label: "Sisa target",
            nilai: formatRupiahRingkas(Math.max(0, total - aktual)),
            penuh: formatRupiah(Math.max(0, total - aktual)),
            sub: (() => {
              const sisa = this.targetSesi.filter(
                (s) => s.status !== "selesai",
              ).length;
              return sisa
                ? `${formatRupiahRingkas(Math.max(0, total - aktual) / sisa)} per sesi tersisa (${sisa} sesi)`
                : "semua sesi selesai";
            })(),
          },
        ];
      },

      /** Warna capaian: hijau ≥ 100%, merah < 100%, abu-abu bila sesi belum selesai. */
      warnaCapai(nilai, status) {
        if (nilai === null || status !== "selesai") return "text-gray-400";
        return nilai >= 100
          ? "text-success-600 dark:text-success-500"
          : "text-error-600 dark:text-error-500";
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
          "gmv_net_2025",
          "gmv_net_2026",
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
