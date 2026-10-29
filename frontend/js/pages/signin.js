import { api } from "../api.js";

/** Halaman masuk, hanya dipakai bila DASHBOARD_PASSWORD diisi. */
export function signinPage() {
  return {
    loaded: true,
    darkMode: false,
    showPassword: false,
    password: "",
    error: "",
    loading: false,
    namaEvent: "",

    async initPage() {
      this.darkMode = document.documentElement.classList.contains("dark");
      this.$watch("darkMode", (value) => {
        try {
          localStorage.setItem("darkMode", JSON.stringify(value));
        } catch {
          // Penyimpanan lokal tidak tersedia.
        }
        document.documentElement.classList.toggle("dark", value);
      });

      try {
        const app = await api.app();
        this.namaEvent = app.event.nama;
        // Sudah masuk, atau login memang tidak diaktifkan: langsung ke tujuan.
        if (!app.auth.aktif || app.auth.masuk) {
          window.location.replace(this.nextPath);
          return;
        }
      } catch (err) {
        this.error = err.message;
      }
      this.loaded = false;
    },

    /** Tujuan setelah masuk, dibatasi ke path internal supaya tidak bisa dipakai open redirect. */
    get nextPath() {
      const next = new URLSearchParams(window.location.search).get("next");
      if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
      return next;
    },

    async submit() {
      if (this.loading) return;
      this.error = "";
      if (!this.password) {
        this.error = "Password wajib diisi.";
        return;
      }
      this.loading = true;
      try {
        await api.login(this.password);
        window.location.href = this.nextPath;
      } catch (err) {
        this.error = err.message;
        this.password = "";
      } finally {
        this.loading = false;
      }
    },
  };
}
