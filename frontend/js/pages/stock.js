/** Query string; nilai array ditulis sebagai parameter berulang (?a=1&a=2). */
function toQuery(params) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => s.append(k, x));
    else if (v !== undefined && v !== null && v !== "") s.append(k, v);
  });
  return s.toString();
}
import {
  formatAngka,
  formatJam,
  formatPersen,
  formatRupiah,
  formatRupiahRingkas,
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

const KOLOM_FILTER = ["warehouse", "brand", "kelas", "status", "atp"];
const filterKosong = () => ({
  q: "",
  ...Object.fromEntries(KOLOM_FILTER.map((k) => [k, []])),
});

const OPSI_ATP = [
  { value: "penuh", label: "ATP 100%" },
  { value: "sebagian", label: "ATP 1–99%" },
  { value: "habis", label: "ATP 0%" },
];

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
    /** User yang sedang masuk: { username, role, utama } */
    user: null,

    // kelola user (admin)
    kelola: {
      buka: false,
      loading: false,
      error: "",
      pesan: "",
      users: [],
      bisaUbah: false,
      form: { username: "", password: "", role: "user" },
    },

    // data
    loading: false,
    error: "",
    mode: "",
    filter: filterKosong(),
    /** Dropdown checklist yang sedang terbuka & teks cari di dalamnya. */
    dropdown: "",
    cariOpsi: "",
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
      options: {
        warehouses: [],
        brands: [],
        kategori: [],
        kelas: [],
        status: [],
      },
      kesegaran: null,
    },
    muatanKe: 0,

    // rincian satu kode tag
    detail: null,
    /** Kode tag yang dicentang untuk export (tetap saat pindah halaman). */
    dipilihTag: [],
    exportLoading: false,
    skuBuka: [],
    tampilNol: false,
    detailLoading: false,
    detailError: "",

    formatAngka,
    formatPersen,
    formatRupiah,
    formatRupiahRingkas,

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
        this.user = app.auth.user || null;
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
        try {
          this.user = (await minta("/api/stock/app")).auth.user;
        } catch {
          this.user = null;
        }
        this.muat();
      } catch (err) {
        this.loginError = err.message;
        this.password = "";
      } finally {
        this.loginLoading = false;
      }
    },

    get isAdmin() {
      return this.user?.role === "admin";
    },

    // ---- Kelola user (admin) ----
    async bukaKelola() {
      this.kelola.buka = true;
      this.kelola.error = "";
      this.kelola.pesan = "";
      await this.aksiUser(null);
    },

    /** Kirim aksi ke /api/stock/users (null = hanya muat daftar). */
    async aksiUser(body, pesanSukses = "") {
      this.kelola.loading = true;
      this.kelola.error = "";
      this.kelola.pesan = "";
      try {
        const d = await minta(
          "/api/stock/users",
          body ? { method: "POST", body } : {},
        );
        this.kelola.users = d.users;
        this.kelola.bisaUbah = d.bisaUbah;
        this.kelola.pesan = pesanSukses;
        return true;
      } catch (err) {
        if (err.status === 401) {
          this.masuk = false;
          this.kelola.buka = false;
        } else this.kelola.error = err.message;
        return false;
      } finally {
        this.kelola.loading = false;
      }
    },

    async tambahUser() {
      const f = this.kelola.form;
      const ok = await this.aksiUser(
        { aksi: "tambah", ...f },
        `User ${f.username.trim().toLowerCase()} ditambahkan dan sudah bisa login.`,
      );
      if (ok) this.kelola.form = { username: "", password: "", role: "user" };
    },

    async hapusUser(u) {
      if (
        !window.confirm(
          `Hapus user ${u.username}? User ini langsung tidak bisa login.`,
        )
      )
        return;
      await this.aksiUser(
        { aksi: "hapus", username: u.username },
        `User ${u.username} dihapus.`,
      );
    },

    async resetPassword(u) {
      const pw = window.prompt(
        `Password baru untuk ${u.username} (minimal 8 karakter):`,
      );
      if (!pw) return;
      await this.aksiUser(
        { aksi: "password", username: u.username, password: pw },
        `Password ${u.username} diganti. Sesi lamanya otomatis keluar.`,
      );
    },

    async ubahRole(u, role) {
      if (role === u.role) return;
      await this.aksiUser(
        { aksi: "role", username: u.username, role },
        `${u.username} sekarang ${role === "admin" ? "admin" : "user biasa"}.`,
      );
    },

    formatWaktu(iso) {
      if (!iso) return "–";
      return new Date(iso).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },

    async logout() {
      try {
        await minta("/api/stock/logout", { method: "POST" });
      } catch {
        // tetap keluar di tampilan
      }
      this.masuk = false;
      this.detail = null;
      this.user = null;
      this.kelola.buka = false;
      this.dipilihTag = [];
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
      this.filter = filterKosong();
      this.ubahFilter();
    },

    get adaFilter() {
      return (
        Boolean(this.filter.q) ||
        KOLOM_FILTER.some((k) => this.filter[k].length)
      );
    },

    /** Daftar dropdown checklist beserta pilihannya. */
    get daftarFilter() {
      const o = this.data.options || {};
      const biasa = (list) => (list || []).map((v) => ({ value: v, label: v }));
      return [
        { k: "warehouse", nama: "gudang", opsi: biasa(o.warehouses) },
        { k: "brand", nama: "brand", opsi: biasa(o.brands) },
        { k: "kelas", nama: "kelas", opsi: biasa(o.kelas) },
        { k: "status", nama: "status", opsi: biasa(o.status) },
        { k: "atp", nama: "ATP", opsi: OPSI_ATP },
      ];
    },

    labelFilter(f) {
      const dipilih = this.filter[f.k];
      if (!dipilih.length) return `Semua ${f.nama}`;
      if (dipilih.length === 1) {
        const o = f.opsi.find((x) => x.value === dipilih[0]);
        return o ? o.label : dipilih[0];
      }
      return `${dipilih.length} ${f.nama} dipilih`;
    },

    opsiTampil(f) {
      const q = this.cariOpsi.trim().toLowerCase();
      return q
        ? f.opsi.filter((o) => o.label.toLowerCase().includes(q))
        : f.opsi;
    },

    bukaDropdown(k) {
      this.dropdown = this.dropdown === k ? "" : k;
      this.cariOpsi = "";
    },

    dipilih(k, v) {
      return this.filter[k].includes(v);
    },

    centang(k, v) {
      const ada = this.filter[k];
      this.filter[k] = ada.includes(v)
        ? ada.filter((x) => x !== v)
        : [...ada, v];
      this.ubahFilter();
    },

    pilihSemua(f) {
      const terlihat = this.opsiTampil(f).map((o) => o.value);
      this.filter[f.k] = [...new Set([...this.filter[f.k], ...terlihat])];
      this.ubahFilter();
    },

    kosongkan(k) {
      if (!this.filter[k].length) return;
      this.filter[k] = [];
      this.ubahFilter();
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
          label: "Stock value",
          nilai: formatRupiahRingkas(s.nilai || 0),
          penuh: formatRupiah(s.nilai || 0),
          sub: "stok × harga jual",
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
      this.skuBuka = [];
      this.tampilNol = false;
      this.detail = { kode_tag: kode, name_tag: "", sku: [] };
      this.detailLoading = true;
      this.detailError = "";
      try {
        const q = toQuery({
          kode_tag: kode,
          warehouse: this.filter.warehouse,
          brand: this.filter.brand,
          kelas: this.filter.kelas,
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

    // ---- Rincian SKU: baris ringkas, klik untuk buka stok per gudang ----
    toggleSku(sku) {
      this.skuBuka = this.skuBuka.includes(sku)
        ? this.skuBuka.filter((x) => x !== sku)
        : [...this.skuBuka, sku];
    },

    skuTerbuka(sku) {
      return this.skuBuka.includes(sku);
    },

    get semuaTerbuka() {
      const n = (this.detail?.sku || []).length;
      return n > 0 && this.skuBuka.length === n;
    },

    toggleSemuaSku() {
      this.skuBuka = this.semuaTerbuka
        ? []
        : (this.detail?.sku || []).map((s) => s.sku);
    },

    /** Ringkasan gudang satu SKU: berapa yang ada stok / minus / nol. */
    infoGudang(s) {
      const g = s.gudang || [];
      return {
        ada: g.filter((x) => x.stock > 0).length,
        minus: g.filter((x) => x.stock < 0).length,
        nol: g.filter((x) => x.stock === 0).length,
      };
    },

    /** Gudang satu SKU, stok terbanyak dulu; stok 0 disembunyikan kecuali diminta. */
    gudangTampil(s) {
      return (s.gudang || [])
        .filter((g) => this.tampilNol || g.stock !== 0)
        .slice()
        .sort(
          (a, b) =>
            b.stock - a.stock || a.warehouse.localeCompare(b.warehouse, "id"),
        );
    },

    get csvUrl() {
      return `/api/stock.csv?${toQuery(this.queryFilter)}`;
    },

    // ---- Pilih kode tag untuk export ----
    tagDipilih(kode) {
      return this.dipilihTag.includes(kode);
    },

    centangTag(kode) {
      this.dipilihTag = this.tagDipilih(kode)
        ? this.dipilihTag.filter((k) => k !== kode)
        : [...this.dipilihTag, kode];
    },

    get semuaHalamanDipilih() {
      const r = this.data.rows;
      return r.length > 0 && r.every((t) => this.tagDipilih(t.kode_tag));
    },

    get sebagianHalamanDipilih() {
      const r = this.data.rows;
      return (
        !this.semuaHalamanDipilih && r.some((t) => this.tagDipilih(t.kode_tag))
      );
    },

    toggleHalaman() {
      const halaman = this.data.rows.map((t) => t.kode_tag);
      this.dipilihTag = this.semuaHalamanDipilih
        ? this.dipilihTag.filter((k) => !halaman.includes(k))
        : [...new Set([...this.dipilihTag, ...halaman])];
    },

    batalPilih() {
      this.dipilihTag = [];
    },

    /**
     * Export CSV: kode tag yang dicentang saja (POST, daftarnya bisa
     * panjang), atau semua kode tag sesuai filter bila tidak ada yang
     * dicentang.
     */
    async exportCsv() {
      if (!this.dipilihTag.length) {
        window.location.href = this.csvUrl;
        return;
      }
      this.exportLoading = true;
      try {
        const res = await fetch("/api/stock.csv", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            warehouse: this.filter.warehouse,
            brand: this.filter.brand,
            kelas: this.filter.kelas,
            status: this.filter.status,
            kode_tag: this.dipilihTag,
          }),
        });
        if (res.status === 401) {
          this.masuk = false;
          return;
        }
        if (!res.ok) throw new Error(`Export gagal (HTTP ${res.status}).`);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `stok-atp-dipilih-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.exportLoading = false;
      }
    },
  };
}
