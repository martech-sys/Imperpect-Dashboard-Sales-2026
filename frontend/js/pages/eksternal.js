import { api } from "../api.js";
import {
  formatAngka,
  formatPersen,
  formatRupiah,
  formatRupiahRingkas,
} from "../format.js";
import { compose } from "../compose.js";
import { pageBase } from "../page-base.js";

const waktuDiubah = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Tab Ringkasan Eksternal: brand yang mencatat penjualannya di Sheet sendiri. */
export function eksternalPage() {
  const base = pageBase({
    page: "eksternal",
    pageTitle: "Ringkasan Eksternal",
    pageSubtitle:
      "Penjualan brand eksternal dari Sheet per brand di Google Drive",
  });
  const statusDasar = Object.getOwnPropertyDescriptor(base, "statusData").get;

  return compose(base, {
    data: {
      summary: {
        trx: 0,
        qty: 0,
        gmv: 0,
        aov: 0,
        pembeli: 0,
        brand: 0,
        brandAktif: 0,
        brandGagal: 0,
      },
      brands: [],
    },
    cari: "",
    brandDipilih: "",
    detail: null,
    memuatDetail: false,
    galatDetail: "",

    formatAngka,
    formatPersen,
    formatRupiah,
    formatRupiahRingkas,

    /** Status data: mode contoh di tab ini berarti folder Drive belum diisi. */
    get statusData() {
      if (!this.error && this.kesegaran?.sumber === "demo") {
        return {
          warna: "bg-warning-500",
          teks: "DRIVE_FOLDER belum diisi — menampilkan data contoh",
        };
      }
      return statusDasar.call(this);
    },

    get brandTampil() {
      const q = this.cari.trim().toLowerCase();
      return q
        ? this.data.brands.filter((b) => b.brand.toLowerCase().includes(q))
        : this.data.brands;
    },

    get kpi() {
      const s = this.data.summary;
      return [
        {
          label: "GMV eksternal",
          nilai: formatRupiahRingkas(s.gmv),
          penuh: formatRupiah(s.gmv),
        },
        {
          label: "Transaksi (TRX)",
          nilai: formatAngka(s.trx),
          penuh: `${formatAngka(s.trx)} baris transaksi`,
        },
        {
          label: "Unit sold",
          nilai: formatAngka(s.qty),
          penuh: `${formatAngka(s.qty)} unit`,
        },
        {
          label: "Brand aktif",
          nilai: `${formatAngka(s.brandAktif)} / ${formatAngka(s.brand)}`,
          penuh:
            "Brand yang sudah punya transaksi / seluruh Sheet brand di folder",
        },
      ];
    },

    diubah(iso) {
      return iso ? waktuDiubah.format(new Date(iso)) : "–";
    },

    status(b) {
      if (b.error)
        return {
          teks: "Gagal dibaca",
          kelas:
            "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400",
        };
      if (!b.trx)
        return {
          teks: "Belum ada transaksi",
          kelas: "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-400",
        };
      if (b.dilewati)
        return {
          teks: `${b.dilewati} baris dilewati`,
          kelas:
            "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400",
        };
      return {
        teks: "OK",
        kelas:
          "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
      };
    },

    restoreState() {
      this.brandDipilih =
        new URLSearchParams(window.location.search).get("brand") || "";
    },

    saveState() {
      const qs = this.brandDipilih
        ? `?brand=${encodeURIComponent(this.brandDipilih)}`
        : "";
      history.replaceState(null, "", qs || window.location.pathname);
    },

    async loadData(muatan) {
      const data = await api.eksternal();
      if (this.usang(muatan)) return;
      this.data = data;
      this.kesegaran = data.kesegaran;
      if (this.brandDipilih) await this.muatDetail();
    },

    async pilihBrand(brand) {
      this.brandDipilih = brand;
      this.saveState();
      if (!brand) {
        this.detail = null;
        return;
      }
      await this.muatDetail();
      this.$nextTick(() =>
        document
          .getElementById("detail-brand")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    },

    async muatDetail() {
      const brand = this.brandDipilih;
      this.memuatDetail = true;
      this.galatDetail = "";
      try {
        const d = await api.eksternalBrand(brand);
        if (brand === this.brandDipilih) this.detail = d;
      } catch (err) {
        if (brand === this.brandDipilih) {
          this.detail = null;
          this.galatDetail = err.message;
        }
      } finally {
        this.memuatDetail = false;
      }
    },

    /** Mengunduh ringkasan per brand persis seperti yang tampil. */
    exportCsv() {
      const sel = (v) => {
        const t = String(v ?? "");
        return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const kepala = [
        "brand",
        "trx",
        "unit",
        "gmv",
        "pembeli",
        "rata_rata_per_trx",
        "kontribusi_persen",
        "terakhir_diubah",
        "status",
      ];
      const baris = this.brandTampil.map((b) => [
        b.brand,
        b.trx,
        b.qty,
        b.gmv,
        b.pembeli,
        b.aov,
        b.kontribusi.toFixed(2),
        b.diubah || "",
        b.error ? `Gagal: ${b.error}` : this.status(b).teks,
      ]);
      const isi = [kepala, ...baris]
        .map((r) => r.map(sel).join(";"))
        .join("\n");
      const blob = new Blob([`﻿${isi}`], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ringkasan-brand-eksternal.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    },
  });
}
