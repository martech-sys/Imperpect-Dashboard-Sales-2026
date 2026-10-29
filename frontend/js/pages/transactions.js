import { api } from "../api.js";
import {
  formatAngka,
  formatRupiah,
  formatTanggalRingkas,
  ringkasTengah,
} from "../format.js";
import { compose } from "../compose.js";
import { pageBase } from "../page-base.js";

const PAGE_SIZES = [25, 50, 100, 200];
const MEDAN = ["brand", "hari", "sesi", "channel"];

/**
 * Susunan kolom tabel rincian. Hanya kolom tingkat invoice yang bisa
 * diurutkan: mengurutkan dengan kolom tingkat baris produk akan memisahkan
 * baris-baris satu invoice, sehingga total bayar yang ditulis sekali di baris
 * pertama jatuh di tempat yang salah.
 */
const KOLOM_TABEL = [
  { key: "brand", label: "Brand", align: "left", sortable: true },
  { key: "tanggal", label: "Tanggal", align: "left", sortable: true },
  { key: "waktu", label: "Jam", align: "left" },
  { key: "invoice", label: "No. invoice", align: "left", sortable: true },
  { key: "sku_produk", label: "SKU", align: "left" },
  { key: "nama_produk", label: "Nama produk", align: "left" },
  { key: "kategori", label: "Kategori", align: "left" },
  { key: "channel", label: "Channel", align: "left", sortable: true },
  { key: "qty", label: "Qty", align: "right" },
  { key: "total_harga_barang", label: "Harga", align: "right" },
  { key: "promo_value", label: "Promo", align: "right" },
  { key: "total_bayar", label: "Total bayar", align: "right" },
  { key: "payment_note", label: "Metode bayar", align: "left" },
  { key: "status", label: "Status", align: "left" },
];

/** Rincian transaksi: satu baris per produk, dikelompokkan per invoice. */
export function transactionsPage() {
  return compose(
    pageBase({
      page: "transactions",
      pageTitle: "Rincian Transaksi",
      pageSubtitle: "Penjualan event per baris produk",
    }),
    {
      result: {
        rows: [],
        total: 0,
        page: 1,
        pageSize: 25,
        summary: { qty: 0, trx: 0, gmv: 0 },
      },
      options: { brands: [], hari: [], sesi: [], channels: [] },
      brand: "",
      hari: "",
      sesi: "",
      channel: "",
      search: "",
      searchTimer: null,
      currentPage: 1,
      pageSize: 25,
      sortBy: "tanggal",
      sortDir: "desc",
      pageSizes: PAGE_SIZES,

      formatAngka,
      formatRupiah,
      formatTanggalRingkas,

      kolomTabel: KOLOM_TABEL,

      /** Pilihan sesi mengikuti hari yang dipilih. */
      get opsiSesi() {
        return this.hari
          ? this.options.sesi.filter(
              (s) => String(s.hari) === String(this.hari),
            )
          : this.options.sesi;
      },

      get filterParams() {
        return {
          brand: this.brand,
          hari: this.hari,
          sesi: this.sesi,
          channel: this.channel,
          q: this.search.trim(),
          sortBy: this.sortBy,
          sortDir: this.sortDir,
        };
      },

      get adaFilter() {
        return MEDAN.some((m) => this[m]) || this.search.trim() !== "";
      },

      /**
       * Baris siap tampil, ditandai batas kelompoknya. Nilai tingkat invoice
       * (dan tanggal) hanya ditulis sekali di baris pertama
       * kelompoknya; mengulangnya membuat batas antar invoice tenggelam.
       */
      get barisTampil() {
        let invoiceSebelum = null;
        let grupSebelum = null;
        return this.result.rows.map((row) => {
          const grup = row.tanggal;
          const invoiceBaru = row.invoice !== invoiceSebelum;
          const grupBaru = grup !== grupSebelum;
          invoiceSebelum = row.invoice;
          grupSebelum = grup;
          return { ...row, invoiceBaru, grupBaru };
        });
      },

      /** Nomor invoice panjang dipendekkan dari tengah; utuhnya ada di tooltip & CSV. */
      invoicePendek(nilai) {
        return nilai ? ringkasTengah(nilai) : "–";
      },

      teks(nilai) {
        return nilai === null || nilai === undefined || nilai === ""
          ? "–"
          : nilai;
      },

      jamPendek(nilai) {
        return nilai ? String(nilai).slice(0, 5) : "–";
      },

      rupiahAtauKosong(nilai) {
        return nilai === null || nilai === undefined ? "" : formatRupiah(nilai);
      },

      rupiahAtauStrip(nilai) {
        return nilai === null || nilai === undefined
          ? "–"
          : formatRupiah(nilai);
      },

      get totalPages() {
        return Math.max(1, Math.ceil(this.result.total / this.pageSize));
      },

      get rangeLabel() {
        if (this.result.total === 0) return "Tidak ada baris";
        const mulai = (this.result.page - 1) * this.result.pageSize + 1;
        const akhir = Math.min(
          this.result.total,
          mulai + this.result.rows.length - 1,
        );
        return `${formatAngka(mulai)}–${formatAngka(akhir)} dari ${formatAngka(this.result.total)} baris`;
      },

      get pageNumbers() {
        const total = this.totalPages;
        const aktif = this.currentPage;
        return [...new Set([1, total, aktif, aktif - 1, aktif + 1])]
          .filter((n) => n >= 1 && n <= total)
          .sort((a, b) => a - b);
      },

      get exportHref() {
        return api.exportUrl(this.filterParams);
      },

      /** Filter dari tautan halaman Sesi × Channel (?sesi=1-2&brand=…). */
      restoreState() {
        const params = new URLSearchParams(window.location.search);
        MEDAN.forEach((m) => {
          if (params.has(m)) this[m] = params.get(m);
        });
        if (params.has("q")) this.search = params.get("q");
        // Sesi menyiratkan harinya, supaya dropdown hari tidak tampak "semua".
        if (this.sesi && !this.hari) this.hari = this.sesi.split("-")[0];
      },

      /** Filter aktif ikut ditulis ke alamat, supaya tampilan bisa dibagikan. */
      saveState() {
        const params = new URLSearchParams();
        MEDAN.forEach((m) => this[m] && params.set(m, this[m]));
        if (this.search.trim()) params.set("q", this.search.trim());
        const qs = params.toString();
        history.replaceState(
          null,
          "",
          qs ? `?${qs}` : window.location.pathname,
        );
      },

      async loadData(muatan) {
        const data = await api.transactions({
          ...this.filterParams,
          page: this.currentPage,
          pageSize: this.pageSize,
        });
        if (this.usang(muatan)) return;
        this.result = data;
        this.options = data.options;
        this.kesegaran = data.kesegaran;
      },

      /** Filter berubah → kembali ke halaman pertama agar hasilnya tidak kosong. */
      setMedan(medan, nilai) {
        this[medan] = nilai;
        if (medan === "hari" && this.sesi && !this.sesi.startsWith(`${nilai}-`))
          this.sesi = "";
        this.refreshFromFirstPage();
      },

      resetFilters() {
        MEDAN.forEach((m) => (this[m] = ""));
        this.search = "";
        this.refreshFromFirstPage();
      },

      async refreshFromFirstPage() {
        this.currentPage = 1;
        await this.refresh();
      },

      onSearchInput() {
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.refreshFromFirstPage(), 350);
      },

      gotoPage(page) {
        const target = Math.min(Math.max(1, page), this.totalPages);
        if (target === this.currentPage) return;
        this.currentPage = target;
        this.refresh();
      },

      urutkan(kolom) {
        if (this.sortBy === kolom) {
          this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
        } else {
          this.sortBy = kolom;
          this.sortDir = kolom === "tanggal" ? "desc" : "asc";
        }
        this.refreshFromFirstPage();
      },

      gantiPageSize(size) {
        this.pageSize = Number(size);
        this.refreshFromFirstPage();
      },
    },
  );
}
