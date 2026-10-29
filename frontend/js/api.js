/**
 * Pembungkus fetch untuk seluruh panggilan API.
 *
 * Respons 401 berarti sesi habis (gerbang password aktif) — pengguna langsung
 * dikembalikan ke halaman masuk agar tidak terjebak di halaman kosong.
 */
async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    window.location.href = `/signin?next=${encodeURIComponent(
      window.location.pathname + window.location.search,
    )}`;
    const error = new Error("Sesi berakhir, silakan masuk kembali.");
    error.redirecting = true;
    throw error;
  }

  const isJson = (response.headers.get("content-type") || "").includes(
    "application/json",
  );
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    // Balasan tanpa JSON berarti permintaan tidak sampai ke aplikasi —
    // biasanya halaman error dari hosting. Kode statusnya disertakan supaya
    // penyebabnya bisa dipersempit tanpa membuka log server.
    const error = new Error(
      payload?.message ||
        `Gagal memuat data (HTTP ${response.status}). Periksa log server.`,
    );
    error.status = response.status;
    error.kesegaran = payload?.kesegaran;
    throw error;
  }

  return payload;
}

/** Menyusun query string dari objek filter, melewati nilai kosong. */
export function toQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.append(key, value);
  });
  return search.toString();
}

/*
 * Cache di browser: jawaban data terakhir per alamat disimpan di
 * localStorage, supaya halaman yang dibuka ulang langsung menampilkan angka
 * terakhir sambil menunggu jawaban baru. Dibatasi beberapa alamat terakhir
 * (paling lama dibuang) dan dikosongkan saat keluar.
 */
const CACHE_PREFIX = "isd.cache.v1:";
const CACHE_INDEX = "isd.cache.v1.index";
const CACHE_MAKS_ALAMAT = 15;
const CACHE_MAKS_UKURAN = 1_500_000;

function bacaCache(path) {
  try {
    const isi = localStorage.getItem(CACHE_PREFIX + path);
    return isi ? JSON.parse(isi) : null;
  } catch {
    return null;
  }
}

function simpanCache(path, payload) {
  try {
    const isi = JSON.stringify(payload);
    if (isi.length > CACHE_MAKS_UKURAN) return;
    const indeks = JSON.parse(localStorage.getItem(CACHE_INDEX) || "[]").filter(
      (p) => p !== path,
    );
    indeks.push(path);
    while (indeks.length > CACHE_MAKS_ALAMAT) {
      localStorage.removeItem(CACHE_PREFIX + indeks.shift());
    }
    localStorage.setItem(CACHE_PREFIX + path, isi);
    localStorage.setItem(CACHE_INDEX, JSON.stringify(indeks));
  } catch {
    // Penyimpanan penuh/tidak tersedia: halaman tetap jalan tanpa cache.
  }
}

export function hapusCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CACHE_PREFIX) || k === CACHE_INDEX)
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // Tidak ada yang perlu dihapus.
  }
}

/**
 * Data dengan cache: `dariCache(isi)` dipanggil seketika bila alamat ini
 * pernah dimuat, lalu janji yang dikembalikan berisi jawaban terbaru.
 *
 * `segar` (tombol Refresh) meminta server membaca ulang sumbernya dan
 * melewati cache CDN; alamat unik `_` memastikan CDN tidak menjawab.
 */
async function muat(path, dariCache, segar = false) {
  const lama = dariCache && !segar ? bacaCache(path) : null;
  if (lama) dariCache(lama);
  const alamat = segar
    ? `${path}${path.includes("?") ? "&" : "?"}segar=1&_=${Date.now()}`
    : path;
  const baru = await request(alamat);
  simpanCache(path, baru);
  return baru;
}

export const api = {
  app: () => request("/api/app"),
  login: (password) =>
    request("/api/auth/login", { method: "POST", body: { password } }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  pivot: (params, dariCache, segar) =>
    muat(`/api/pivot?${toQuery(params)}`, dariCache, segar),
  transactions: (params, dariCache, segar) =>
    muat(`/api/transactions?${toQuery(params)}`, dariCache, segar),
  exportUrl: (params) => `/api/transactions.csv?${toQuery(params)}`,
  eksternal: (dariCache, segar) => muat("/api/eksternal", dariCache, segar),
  ringkasan: (dariCache, segar) => muat("/api/ringkasan", dariCache, segar),
  eksternalBrand: (brand, dariCache, segar) =>
    muat(`/api/eksternal/brand?${toQuery({ brand })}`, dariCache, segar),
};
