"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const { createDriveSource, folderIdOf } = require("../server/eksternal/drive");
const { ringkasan, detailBrand } = require("../server/eksternal");
const {
  toNum,
  normPhone,
  parseCSV,
  rowsToRecords,
} = require("../server/eksternal/sheet");

test("angka dan nomor HP dibaca seperti papan TV", () => {
  assert.equal(toNum("Rp 2.500.000"), 2500000);
  assert.equal(toNum("1,500,000"), 1500000);
  assert.equal(toNum("750000.00"), 750000);
  assert.ok(Number.isNaN(toNum("")));
  assert.equal(normPhone("+62 812-3456-7890"), "081234567890");
  assert.equal(normPhone("6.28123E+12"), "");
});

test("kolom dikenali dari judulnya, urutan bebas", () => {
  const rows = parseCSV(
    'trx value,Nama,No HP,qty\r\n"1.500.000",Dewi,0812345678,2\r\n,,,\r\n',
  );
  assert.deepEqual(rowsToRecords(rows), [
    {
      baris: 2,
      phone: "0812345678",
      name: "Dewi",
      qty: "2",
      value: "1.500.000",
    },
  ]);
});

const FILES = [
  {
    brand: "Klamby",
    diubah: "2026-10-30T03:00:00Z",
    error: null,
    records: [
      {
        baris: 2,
        phone: "081234567890",
        name: "dewi lestari",
        qty: "2",
        value: "1.000.000",
      },
      {
        baris: 3,
        phone: "6281234567890",
        name: "Dewi",
        qty: "1",
        value: "500000",
      },
      { baris: 4, phone: "", name: "Tanpa HP", qty: "1", value: "250000" },
      { baris: 5, phone: "081111111111", name: "Kosong", qty: "1", value: "" },
    ],
  },
  {
    brand: "Rurik",
    diubah: null,
    error: "HTTP 429",
    records: [
      {
        baris: 2,
        phone: "081234567890",
        name: "Dewi",
        qty: "3",
        value: "250.000",
      },
    ],
  },
  { brand: "Casio", diubah: "2026-10-30T04:00:00Z", error: null, records: [] },
];

test("ringkasan: baris tanpa HP tetap terjual, pembeli dihitung dari HP berbeda", () => {
  const r = ringkasan(FILES);
  assert.deepEqual(
    r.brands.map((b) => [b.brand, b.trx, b.qty, b.gmv, b.pembeli, b.dilewati]),
    [
      ["Klamby", 3, 4, 1750000, 1, 1],
      ["Rurik", 1, 3, 250000, 1, 0],
      ["Casio", 0, 0, 0, 0, 0],
    ],
  );
  assert.equal(r.summary.gmv, 2000000);
  assert.equal(r.summary.trx, 4);
  // nomor yang sama di dua brand dihitung satu pembeli di TOTAL
  assert.equal(r.summary.pembeli, 1);
  assert.equal(r.summary.brandAktif, 2);
  assert.equal(r.summary.brandGagal, 1);
  assert.equal(r.brands[0].kontribusi, 87.5);
});

test("detail brand: HP disamarkan, nama dipendekkan, baris dilewati dilaporkan", () => {
  const d = detailBrand(FILES, "Klamby");
  assert.deepEqual(d.barisDilewati, [5]);
  assert.deepEqual(d.pembeliTeratas, [
    { hp: "0812-xxxx-7890", nama: "Dewi L.", trx: 2, qty: 3, gmv: 1500000 },
  ]);
  assert.equal(d.rows.length, 4);
  assert.equal(d.rows[3].valid, false);
  assert.ok(!JSON.stringify(d).includes("081234567890"));
  assert.equal(detailBrand(FILES, "Tidak Ada"), null);
});

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const SA = JSON.stringify({
  client_email: "dash@proj.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
});

/** Pengganti oauth2 + Drive v3: satu folder, ekspor CSV per file. */
function mockGoogle() {
  const calls = { export: [] };
  const state = {
    files: [
      { id: "f1", name: "Klamby", modifiedTime: "t1" },
      { id: "f2", name: "Rurik", modifiedTime: "t1" },
      { id: "f3", name: "Rekap INTERNAL", modifiedTime: "t1" },
    ],
    csv: {
      f1: "No HP,Nama,qty,trx value\n081234567890,Dewi,2,1000000",
      f2: "No HP,Nama,qty,trx value",
      f3: "No HP,Nama,qty,trx value\n081234567890,Dewi,1,999999999",
    },
    fail: new Set(),
  };
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url.pathname === "/token")
      return send(200, { access_token: "tok", expires_in: 3600 });
    if (req.headers.authorization !== "Bearer tok")
      return send(401, { error: { message: "no auth" } });
    if (url.pathname === "/drive/files")
      return send(200, { files: state.files });
    const m = url.pathname.match(/^\/drive\/files\/([^/]+)\/export$/);
    if (m) {
      calls.export.push(m[1]);
      if (state.fail.has(m[1]))
        return send(429, { error: { message: "Quota exceeded" } });
      res.writeHead(200, { "Content-Type": "text/csv" });
      return res.end(state.csv[m[1]]);
    }
    return send(404, {});
  });
  return new Promise((resolve) =>
    srv.listen(0, () => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      resolve({
        srv,
        calls,
        state,
        urls: { token: `${base}/token`, drive: `${base}/drive` },
      });
    }),
  );
}

test("Drive: hanya file yang berubah dibaca ulang; file gagal memakai isi terakhir", async () => {
  const g = await mockGoogle();
  try {
    const src = createDriveSource({
      folder: "https://drive.google.com/drive/folders/FOLDER_ID_123",
      json: SA,
      urls: g.urls,
      exclude: ["internal"],
    });
    const a = await src.fetch();
    assert.deepEqual(
      a.map((f) => [f.brand, f.records.length]),
      [
        ["Klamby", 1],
        ["Rurik", 0],
      ],
    );
    assert.deepEqual(g.calls.export, ["f1", "f2"]);

    await src.fetch();
    assert.equal(g.calls.export.length, 2); // tidak ada yang berubah

    g.state.files[0].modifiedTime = "t2";
    g.state.fail.add("f1");
    const c = await src.fetch();
    assert.match(c[0].error, /429/);
    assert.equal(c[0].records.length, 1);
  } finally {
    g.srv.close();
  }
});

test("Drive: konfigurasi salah ditolak dengan pesan jelas", () => {
  assert.throws(
    () => createDriveSource({ folder: "x", json: SA }),
    /DRIVE_FOLDER/,
  );
  assert.throws(
    () => createDriveSource({ folder: "FOLDER_ID_123", json: "{" }),
    /bukan JSON/,
  );
  assert.equal(
    folderIdOf("https://drive.google.com/drive/u/0/folders/AbC_123-xyz"),
    "AbC_123-xyz",
  );
});
