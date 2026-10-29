import { api, hapusCache } from "./api.js";
import { formatJam, formatTanggalSedang } from "./format.js";

/**
 * Kerangka bersama halaman dashboard: info event, state tampilan (sidebar,
 * mode gelap), status pemuatan, kesegaran data, dan muat ulang otomatis.
 *
 * Halaman turunan cukup menyediakan `loadData(muatan)`.
 */
export function pageBase({ page, pageTitle, pageSubtitle }) {
  return {
    page,
    pageTitle,
    pageSubtitle,

    // Tampilan
    loaded: true,
    darkMode: false,
    sidebarToggle: false,

    // Info aplikasi dari /api/app
    app: null,

    // Status pemuatan. Nomor urut permintaan: jawaban dari permintaan lama
    // diabaikan supaya tidak menimpa data dari filter yang lebih baru.
    muatanKe: 0,
    loading: true,
    error: "",
    /** Kesegaran data, dikirim server bersama datanya. */
    kesegaran: null,
    lastUpdated: "",
    /** Yang tampil adalah data tersimpan di browser; jawaban baru sedang dimuat. */
    dariCache: false,
    muatOtomatis: false,
    muatSegar: false,
    detik: Date.now(),

    get demoMode() {
      return this.app?.mode === "demo";
    },

    get authAktif() {
      return Boolean(this.app?.auth?.aktif);
    },

    get eventLabel() {
      const e = this.app?.event;
      if (!e) return "";
      return `${formatTanggalSedang(e.dari)} – ${formatTanggalSedang(e.sampai)}`;
    },

    /**
     * Usia data apa adanya: kapan server terakhir berhasil membaca warehouse,
     * bukan kapan halaman ini memuatnya.
     */
    get usiaData() {
      const k = this.kesegaran;
      if (!k?.fetchedAt) return "";
      // `detik` hanya dipakai supaya label ini ikut diperbarui tiap 30 detik.
      const menit = Math.max(
        0,
        Math.round((this.detik - new Date(k.fetchedAt).getTime()) / 60000),
      );
      const asal = k.sumber === "demo" ? "data contoh" : "data";
      if (menit < 1) return `${asal} baru saja dibaca`;
      if (menit < 60) return `${asal} ${menit} menit lalu`;
      return `${asal} pukul ${formatJam(new Date(k.fetchedAt))}`;
    },

    /** Titik status: hijau = segar, oranye = memakai data lama, merah = gagal. */
    get statusData() {
      if (this.error) return { warna: "bg-error-500", teks: this.error };
      if (this.dariCache) {
        return {
          warna: "bg-gray-400",
          teks: `Menampilkan data tersimpan (${this.usiaData}) — memuat data terbaru…`,
        };
      }
      const k = this.kesegaran;
      if (!k) return { warna: "bg-gray-400", teks: "Memuat data…" };
      if (k.stale) {
        return {
          warna: "bg-warning-500",
          teks: `Gagal membaca data terbaru (${k.error}) — menampilkan ${this.usiaData}`,
        };
      }
      if (k.uji) {
        return {
          warna: "bg-warning-500",
          teks: `Mode uji · ${k.uji.limit} baris pertama gudang ${k.uji.warehouse} · ${this.usiaData}`,
        };
      }
      if (k.sumber === "demo") {
        return {
          warna: "bg-warning-500",
          teks: "Database belum diisi — menampilkan data contoh",
        };
      }
      return { warna: "bg-success-500", teks: `Live · ${this.usiaData}` };
    },

    async initPage() {
      this.darkMode = document.documentElement.classList.contains("dark");
      this.$watch("darkMode", (value) => {
        try {
          localStorage.setItem("darkMode", JSON.stringify(value));
        } catch {
          // Penyimpanan lokal tidak tersedia — mode berlaku untuk sesi ini saja.
        }
        document.documentElement.classList.toggle("dark", value);
      });

      // Info aplikasi dan data dimuat bersamaan, bukan berurutan: data
      // (dari cache browser lalu dari server) tidak perlu menunggu /api/app.
      this.restoreState?.();
      const muatPertama = this.refresh();

      try {
        this.app = await api.app();
      } catch (err) {
        this.error = err.message;
        this.loading = false;
        this.loaded = false;
        return;
      }

      // Di Vercel HTML dilayani CDN, jadi pagar halamannya dijalankan di sini;
      // datanya sendiri tetap dijaga server (401 tanpa sesi).
      if (this.app.auth.aktif && !this.app.auth.masuk) {
        hapusCache();
        window.location.replace(
          `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
        return;
      }

      this.loaded = false;
      await muatPertama;

      // Event berjalan live: muat ulang berkala selama tab terlihat.
      const jeda = (this.app.refreshSeconds || 60) * 1000;
      setInterval(() => {
        if (!document.hidden) this.refresh({ otomatis: true });
      }, jeda);
      setInterval(() => (this.detik = Date.now()), 30000);
    },

    usang(muatan) {
      return muatan !== undefined && muatan !== this.muatanKe;
    },

    /** Memuat ulang data halaman dengan filter terkini. */
    /**
     * `segar: true` dari tombol Refresh: minta server membaca ulang sumbernya
     * dan lewati cache CDN, supaya yang tampil benar-benar angka terbaru.
     */
    async refresh({ otomatis = false, segar = false } = {}) {
      this.muatOtomatis = otomatis;
      this.muatSegar = segar;
      this.saveState?.();
      const muatan = (this.muatanKe += 1);
      this.loading = true;
      try {
        await this.loadData(muatan);
        if (this.usang(muatan)) return;
        this.dariCache = false;
        this.error = "";
        this.lastUpdated = formatJam(new Date());
        this.detik = Date.now();
      } catch (err) {
        if (this.usang(muatan) || err.redirecting) return;
        this.error = err.message;
        if (err.kesegaran) this.kesegaran = err.kesegaran;
      } finally {
        if (!this.usang(muatan)) this.loading = false;
      }
    },

    /** Diisi oleh masing-masing halaman. */
    async loadData() {},

    /**
     * Penerima data tersimpan untuk `api.*(…, dariCache)`: dipakai hanya bila
     * permintaan ini masih yang terbaru dan belum ada jawaban server.
     */
    dariCacheUntuk(muatan, terapkan) {
      return (isi) => {
        // Muat ulang berkala: yang tampil sudah data terbaru, tidak perlu cache.
        if (this.usang(muatan) || this.muatOtomatis) return;
        terapkan(isi);
        this.dariCache = true;
      };
    },

    async logout() {
      hapusCache();
      try {
        await api.logout();
      } finally {
        window.location.href = "/signin";
      }
    },
  };
}
