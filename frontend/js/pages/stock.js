import { toQuery } from "../api.js";
import {
  formatAngka,
  formatJam,
  formatPersen,
  formatRupiah,
} from "../format.js";

/**
 * Dashboard stok (/stock): kode tag dengan Stock & ATP dari stock_sum_new,
 * klik satu kode tag untuk metrik per SKU. Login sendiri (username +
 * password), terpisah dari dashboard penjualan.
 */
async function minta(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = (res.headers.get("content-type") || "").includes("json")
    ? await res.json()
    : null;
  if (!res.ok) {
    const err = new Error(
      json?.message || `Gagal memuat data (HTTP ${res.status}).`,
    );
    err.status = res.status;
    throw err;
  }
  return json;
}

const FILTER_KOSONG = {
  q: "",
  warehouse: "",
  brand: "",
  kategori: "",
  status: "",
  atp: "",
};

export function stockPage() {
  return {
    loaded: true,
    darkMode: false,

    // login
    cekLogin: true,
    masuk: false,
    username: "",
    password: "",
    showPassword: false,
    loginError: "",
    loginLoading: false,

    // data
    loading: false,
    error: "",
    mode: "",
    filter: { ...FILTER_KOSONG },
    sortBy: "stock",
    sortDir: "desc",
    page: 1,
    pageSize: 50,
    data: {
      summary: {
        kode_tag: 0,
        total_sku: 0,
        sku_ada: 0,
        stock: 0,
        atp: 0,
        tag_penuh: 0,
        tag_habis: 0,
      },
      rows: [],
      total: 0,
      options: { warehouses: [], brands: [], kategori: [], status: [] },
      kesegaran: null,
    },
    muatanKe: 0,

    // rincian satu kode tag
    detail: null,
    detailLoading: false,
    detailError: "",

    formatAngka,
    formatPersen,
    formatRupiah,

    async initPage() {
      this.darkMode = document.documentElement.classList.contains("dark");
      this.$watch("darkMode", (v) => {
        try {
          localStorage.setItem("darkMode", JSON.stringify(v));
        } catch {
          // penyimpanan lokal tidak tersedia
        }
        document.documentElement.classList.toggle("dark", v);
      });
      try {
        const app = await minta("/api/stock/app");
        this.mode = app.mode;
        this.masuk = app.auth.masuk;
        if (!app.auth.aktif) {
          this.loginError =
            "Login dashboard stok belum diaktifkan: isi STOCK_PASSWORD di environment variable Vercel.";
        }
      } catch (err) {
        this.loginError = err.message;
      }
      this.cekLogin = false;
      this.loaded = false;
      if (this.masuk) this.muat();
    },

    async login() {
      if (this.loginLoading) return;
      this.loginError = "";
      if (!this.username || !this.password) {
        this.loginError = "Username dan password wajib diisi.";
        return;
      }
      this.loginLoading = true;
      try {
        await minta("/api/stock/login", {
          method: "POST",
          body: { username: this.username, password: this.password },
        });
        this.masuk = true;
        this.password = "";
        this.muat();
      } catch (err) {
        this.loginError = err.message;
        this.password = "";
      } finally {
        this.loginLoading = false;
      }
    },

    async logout() {
      try {
        await minta("/api/stock/logout", { method: "POST" });
      } catch {
        // tetap keluar di tampilan
      }
      this.masuk = false;
      this.detail = null;
      this.username = "";
    },

    get queryFilter() {
      return { ...this.filter };
    },

    async muat(segar = false) {
      const ke = ++this.muatanKe;
      this.loading = true;
      this.error = "";
      const q = toQuery({
        ...this.queryFilter,
        sortBy: this.sortBy,
        sortDir: this.sortDir,
        page: this.page,
        pageSize: this.pageSize,
        ...(segar ? { segar: 1, _: Date.now() } : {}),
      });
      try {
        const d = await minta(`/api/stock?${q}`);
        if (ke !== this.muatanKe) return;
        this.data = d;
      } catch (err) {
        if (ke !== this.muatanKe) return;
        if (err.status === 401) {
          this.masuk = false;
          this.loginError = "Sesi berakhir, silakan masuk kembali.";
        } else this.error = err.message;
      } finally {
        if (ke === this.muatanKe) this.loading = false;
      }
    },

    ubahFilter() {
      this.page = 1;
      this.muat();
    },

    resetFilter() {
      this.filter = { ...FILTER_KOSONG };
      this.ubahFilter();
    },

    get adaFilter() {
      return Object.values(this.filter).some(Boolean);
    },

    urut(kolom) {
      if (this.sortBy === kolom)
        this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
      else {
        this.sortBy = kolom;
        this.sortDir =
          kolom === "kode_tag" || kolom === "name_tag" ? "asc" : "desc";
      }
      this.page = 1;
      this.muat();
    },

    panah(kolom) {
      if (this.sortBy !== kolom) return "";
      return this.sortDir === "asc" ? "▲" : "▼";
    },

    get jumlahHalaman() {
      return Math.max(1, Math.ceil(this.data.total / this.pageSize));
    },

    keHalaman(n) {
      const p = Math.min(Math.max(1, n), this.jumlahHalaman);
      if (p === this.page) return;
      this.page = p;
      this.muat();
    },

    get rentangBaris() {
      if (!this.data.total) return "0";
      const a = (this.page - 1) * this.pageSize + 1;
      const b = Math.min(this.page * this.pageSize, this.data.total);
      return `${formatAngka(a)}–${formatAngka(b)} dari ${formatAngka(this.data.total)}`;
    },

    get kpi() {
      const s = this.data.summary;
      return [
        {
          label: "ATP keseluruhan",
          nilai: formatPersen(s.atp),
          sub: `${formatAngka(s.sku_ada)} dari ${formatAngka(s.total_sku)} SKU ada stok`,
          progres: s.atp,
        },
        {
          label: "Total stock",
          nilai: formatAngka(s.stock),
          sub: `${formatAngka(s.total_sku)} SKU`,
        },
        {
          label: "Kode tag",
          nilai: formatAngka(s.kode_tag),
          sub: `${formatAngka(s.tag_penuh)} ATP 100% · ${formatAngka(s.tag_habis)} ATP 0%`,
        },
        {
          label: "SKU kosong",
          nilai: formatAngka(s.total_sku - s.sku_ada),
          sub: "stok 0 atau minus",
        },
      ];
    },

    warnaAtp(atp) {
      if (atp >= 80) return "bg-success-500";
      if (atp >= 50) return "bg-warning-500";
      return "bg-error-500";
    },

    teksAtp(atp) {
      if (atp >= 80) return "text-success-600 dark:text-success-500";
      if (atp >= 50) return "text-warning-600 dark:text-warning-500";
      return "text-error-600 dark:text-error-500";
    },

    get statusData() {
      if (this.error) return { warna: "bg-error-500", teks: this.error };
      const k = this.data.kesegaran;
      if (!k) return { warna: "bg-gray-400", teks: "Memuat data…" };
      const jam = k.fetchedAt ? formatJam(new Date(k.fetchedAt)) : "-";
      if (k.stale)
        return {
          warna: "bg-warning-500",
          teks: `Gagal membaca data terbaru (${k.error}) — data pukul ${jam}`,
        };
      if (k.sumber === "demo")
        return {
          warna: "bg-warning-500",
          teks: "Database belum diisi — menampilkan data contoh",
        };
      return { warna: "bg-success-500", teks: `Data stok pukul ${jam}` };
    },

    async bukaTag(kode) {
      this.detail = { kode_tag: kode, name_tag: "", sku: [] };
      this.detailLoading = true;
      this.detailError = "";
      try {
        const q = toQuery({
          kode_tag: kode,
          warehouse: this.filter.warehouse,
          brand: this.filter.brand,
          kategori: this.filter.kategori,
          status: this.filter.status,
        });
        const d = await minta(`/api/stock/tag?${q}`);
        if (this.detail?.kode_tag === kode) this.detail = d;
      } catch (err) {
        if (err.status === 401) {
          this.masuk = false;
          this.detail = null;
        } else this.detailError = err.message;
      } finally {
        this.detailLoading = false;
      }
    },

    tutupTag() {
      this.detail = null;
    },

    get banyakGudang() {
      return (this.detail?.sku || []).some((s) => s.gudang.length > 1);
    },

    get csvUrl() {
      return `/api/stock.csv?${toQuery(this.queryFilter)}`;
    },
  };
}
