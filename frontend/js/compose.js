/**
 * Menggabungkan beberapa bagian komponen Alpine menjadi satu objek.
 *
 * Sengaja tidak memakai spread (`{ ...a, ...b }`): spread *mengeksekusi*
 * getter dan menyalin hasilnya, sehingga properti turunan seperti
 * `filterParams` atau `roleLabel` akan membeku pada nilai awalnya dan tidak
 * pernah ikut berubah saat state berubah. Menyalin deskriptor properti
 * mempertahankan getter apa adanya.
 */
export function compose(...parts) {
  const target = {};
  for (const part of parts) {
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(part));
  }
  return target;
}
