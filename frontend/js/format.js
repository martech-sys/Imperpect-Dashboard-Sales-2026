const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const angka = new Intl.NumberFormat("id-ID");

const tanggalPanjang = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const tanggalPendek = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
});

const tanggalSedang = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const jam = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
});

export const formatRupiah = (value) => rupiah.format(Number(value) || 0);

export const formatAngka = (value) => angka.format(Number(value) || 0);

/**
 * Bentuk ringkas untuk kartu KPI dan sumbu grafik: 1,2 jt / 3,4 M / 5,6 T.
 * Nilai penuhnya tetap tersedia di tooltip dan tampilan tabel.
 */
export function formatRupiahRingkas(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const tanda = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${tanda}Rp ${angkaDesimal(abs / 1e12)} T`;
  if (abs >= 1e9) return `${tanda}Rp ${angkaDesimal(abs / 1e9)} M`;
  if (abs >= 1e6) return `${tanda}Rp ${angkaDesimal(abs / 1e6)} jt`;
  if (abs >= 1e3) return `${tanda}Rp ${angkaDesimal(abs / 1e3)} rb`;
  return formatRupiah(n);
}

function angkaDesimal(value) {
  return value.toLocaleString("id-ID", {
    minimumFractionDigits: value >= 100 ? 0 : 1,
    maximumFractionDigits: value >= 100 ? 0 : 1,
  });
}

export function formatPersen(value, digits = 1) {
  const n = Number(value) || 0;
  return `${n.toLocaleString("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/** Selisih bertanda untuk badge naik/turun. */
export function formatDelta(value) {
  const n = Number(value) || 0;
  return `${n > 0 ? "+" : ""}${formatPersen(n)}`;
}

export const formatTanggal = (iso) =>
  iso ? tanggalPanjang.format(new Date(`${iso}T00:00:00`)) : "-";

export const formatTanggalPendek = (iso) =>
  iso ? tanggalPendek.format(new Date(`${iso}T00:00:00`)) : "-";

/** Bentuk sedang ("21 Sep 2026") untuk ruang sempit seperti kotak rentang tanggal. */
export const formatTanggalSedang = (iso) =>
  iso ? tanggalSedang.format(new Date(`${iso}T00:00:00`)) : "-";

/**
 * Bentuk paling ringkas ("1-Sep-2026"), untuk kolom tabel yang berdampingan
 * dengan belasan kolom lain. Tanda hubung menyatukan ketiga bagiannya menjadi
 * satu blok, sehingga tidak terbaca sebagai tiga kolom terpisah saat dipindai
 * dari atas ke bawah.
 */
export function formatTanggalRingkas(iso) {
  if (!iso) return "-";
  const bagian = tanggalSedang
    .formatToParts(new Date(`${iso}T00:00:00`))
    .filter((p) => ["day", "month", "year"].includes(p.type))
    .map((p) => p.value.replace(/\.$/, ""));
  return bagian.join("-");
}

/**
 * Memendekkan teks panjang dari tengahnya: awal dan akhirnya tetap terbaca.
 *
 * Nomor invoice dibedakan oleh kedua ujungnya — awalnya menyebut store,
 * akhirnya nomor urut — jadi memotong salah satu ujung saja membuat dua
 * invoice berbeda tampak identik.
 */
export function ringkasTengah(nilai, awal = 6, akhir = 5) {
  const teks = String(nilai ?? "");
  if (teks.length <= awal + akhir + 1) return teks;
  return `${teks.slice(0, awal)}…${teks.slice(-akhir)}`;
}

export const formatJam = (date) => jam.format(date);

/** Inisial nama untuk avatar teks di header. */
export function inisial(nama) {
  if (!nama) return "?";
  return nama
    .split(/\s+/)
    .slice(0, 2)
    .map((kata) => kata[0]?.toUpperCase() || "")
    .join("");
}
