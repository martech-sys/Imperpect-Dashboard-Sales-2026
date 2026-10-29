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
  const b = await store.get();
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
