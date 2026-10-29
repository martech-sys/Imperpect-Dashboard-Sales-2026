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

export const api = {
  app: () => request("/api/app"),
  login: (password) =>
    request("/api/auth/login", { method: "POST", body: { password } }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  pivot: (params) => request(`/api/pivot?${toQuery(params)}`),
  transactions: (params) => request(`/api/transactions?${toQuery(params)}`),
  exportUrl: (params) => `/api/transactions.csv?${toQuery(params)}`,
  eksternal: () => request("/api/eksternal"),
  eksternalBrand: (brand) =>
    request(`/api/eksternal/brand?${toQuery({ brand })}`),
};
