"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSesi } = require("../server/sesi");
const { createStore } = require("../server/store");

const event = { dari: "2026-10-30", sesi: parseSesi("") };

test("sumber gagal: data terakhir tetap dipakai dan ditandai stale", async () => {
  let jam = 0;
  let gagal = false;
  let dibaca = 0;
  const source = {
    name: "postgres",
    async fetch() {
      dibaca += 1;
      if (gagal) throw new Error("timeout");
      return [
        {
          tanggal: "2026-10-30",
          waktu: "09:00:00",
          invoice: "A",
          qty: "1",
          status: "Delivery",
        },
      ];
    },
    close: async () => {},
  };
  const store = createStore(source, event, {
    cacheSeconds: 60,
    now: () => jam,
  });

  const a = await store.get();
  assert.equal(a.rows.length, 1);
  assert.equal(a.kesegaran.stale, false);

  // Masih dalam jendela cache: tidak membaca ulang.
  jam = 30_000;
  await store.get();
  assert.equal(dibaca, 1);

  jam = 61_000;
  gagal = true;
  const b = await store.get({ tunggu: true });
  assert.equal(dibaca, 2);
  assert.equal(b.rows.length, 1);
  assert.equal(b.kesegaran.stale, true);
  assert.equal(b.kesegaran.error, "timeout");
});

test("permintaan bersamaan menunggu satu pembacaan yang sama", async () => {
  let dibaca = 0;
  const source = {
    name: "postgres",
    fetch: () => new Promise((r) => setTimeout(() => r([], (dibaca += 1)), 20)),
    close: async () => {},
  };
  const store = createStore(source, event, { cacheSeconds: 60 });
  await Promise.all([store.get(), store.get(), store.get()]);
  assert.equal(dibaca, 1);
});

test("data kedaluwarsa langsung dikirim; pembacaan baru berjalan di belakang", async () => {
  let jam = 0;
  let isi = "1";
  let lepas;
  const ditahan = [];
  const source = {
    name: "postgres",
    fetch: () =>
      new Promise((r) => {
        lepas = () =>
          r([
            {
              tanggal: "2026-10-30",
              waktu: "09:00:00",
              invoice: "A",
              qty: isi,
              status: "Delivery",
            },
          ]);
        if (isi === "1") lepas();
      }),
    close: async () => {},
  };
  const store = createStore(source, event, {
    cacheSeconds: 60,
    now: () => jam,
    waitUntil: (p) => ditahan.push(p),
  });

  // Permintaan pertama harus menunggu: belum ada data sama sekali.
  assert.equal((await store.get()).rows[0].qty, 1);

  // Lewat 60 detik: jawaban langsung berisi data lama, pembacaan baru belum selesai.
  jam = 61_000;
  isi = "5";
  const lama = await store.get();
  assert.equal(lama.rows[0].qty, 1);
  assert.equal(lama.kesegaran.memperbarui, true);
  assert.equal(ditahan.length, 2);

  // Setelah pembacaan di belakang selesai, permintaan berikutnya mendapat data baru.
  lepas();
  await ditahan[1];
  const baru = await store.get();
  assert.equal(baru.rows[0].qty, 5);
  assert.equal(baru.kesegaran.memperbarui, false);
});
