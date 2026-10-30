import { api } from "../api.js";
import { formatPersen, formatRupiah, formatRupiahRingkas } from "../format.js";
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
};

/**
 * Tab Target 2026: target brand dibagi ke tiap sesi secara proporsional
 * (porsi penjualan 2025) dibandingkan aktual GMV (total harga barang).
 */
export function targetPage() {
  return compose(
    pageBase({
      page: "target",
      pageTitle: "Target 2026",
      pageSubtitle: "Target brand per sesi vs aktual GMV",
    }),
    {
      data: {
        insight: [],
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

      formatPersen,
      formatRupiah,
      formatRupiahRingkas,

      status: (s) => STATUS[s] || STATUS.belum,

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
        return t.sesi.map((s) => {
          const aktual = kunci.reduce((a, k) => a + (s.aktual[k] || 0), 0);
          const prop = total * s.bobot;
          return {
            ...s,
            prop,
            aktual,
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
              prop: 0,
              aktual: 0,
            };
            grup.push(g);
          }
          g.sesi.push(s);
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
            label: "Aktual GMV (harga barang)",
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
              return sisa ? `${sisa} sesi tersisa` : "semua sesi selesai";
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

      async loadData(muatan) {
        const terapkan = (data) => {
          this.data = data;
          this.kesegaran = data.kesegaran;
        };
        const data = await api.target(
          this.dariCacheUntuk(muatan, terapkan),
          this.muatSegar,
        );
        if (this.usang(muatan)) return;
        terapkan(data);
      },

      /** Mengunduh target & aktual per sesi untuk pilihan saat ini. */
      exportCsv() {
        const kepala = [
          "hari",
          "jam",
          "sesi_2026",
          "status",
          "porsi_2025_persen",
          "target_proporsional",
          "aktual_gmv",
          "capaian_vs_proporsional_persen",
        ];
        const baris = this.targetSesi.map((s) => [
          s.nama,
          s.jam,
          s.sesi2026,
          s.status,
          (s.bobot * 100).toFixed(2),
          Math.round(s.prop),
          s.aktual,
          s.capaiProp === null ? "" : s.capaiProp.toFixed(1),
        ]);
        const isi = [kepala, ...baris].map((r) => r.join(";")).join("\n");
        const blob = new Blob([`\ufeff${isi}`], {
          type: "text/csv;charset=utf-8",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        const pilih = this.targetPilih.replace(/^[kb]:/, "") || "semua";
        a.download = `target-2026-${pilih.toLowerCase()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      },
    },
  );
}
