import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, safeFetchUrl, setSafeFetchLookup, UnsafeUrlError, type LookupFn } from "../lib/generation/safe-fetch.ts";
import { fetchImageBytes } from "../lib/generation/slide-images.ts";
import { makeAishaTts } from "../lib/generation/tts/aisha.ts";

/**
 * TASHQI URL XAVFSIZLIGI (audit EXT-15).
 *
 * Provayder javobidagi URL (stock rasm, Aisha audio, grounding redirect)
 * worker'ni ichki tarmoqqa (`127.0.0.1`, `10.x`, `169.254.169.254` bulut
 * metadata) so'rov yuborishga majburlay olmasligi kerak — na to'g'ridan-
 * to'g'ri, na redirect orqali. Hech bir test tarmoqqa chiqmaydi: `fetch`
 * va DNS stub.
 */

const PUBLIC: LookupFn = async () => ["93.184.216.34"];
const DNS: Record<string, string[]> = {
  "images.pexels.com": ["104.18.1.1"],
  "cdn.example.com": ["104.18.2.2"],
  "internal.example.com": ["10.0.0.7"],
  "meta.example.com": ["169.254.169.254"],
  "mixed.example.com": ["104.18.3.3", "127.0.0.1"],
};
const lookup: LookupFn = async (h) => {
  const a = DNS[h];
  if (!a) throw new Error(`ENOTFOUND ${h}`);
  return a;
};

/** Haqiqiy `fetch` redirectni O'ZI kuzatganday tutadigan stub: `redirect:"follow"` bo'lsa ichki manzilga «boradi». */
function redirectingFetch(hits: string[], map: Record<string, string>, final: () => Response) {
  return (async (url: string, init?: RequestInit) => {
    hits.push(String(url));
    const to = map[String(url)];
    if (to) {
      if (init?.redirect === "manual") return new Response(null, { status: 302, headers: { location: to } });
      hits.push(to);
      return final();
    }
    return final();
  }) as typeof fetch;
}

const PNG = (() => {
  const b = Buffer.alloc(2048);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(10, 16);
  b.writeUInt32BE(10, 20);
  return b;
})();

test("isPrivateAddress: loopback/xususiy/link-local/CGNAT/IPv6 ichki — rad, ommaviy — o'tadi", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("safeFetchUrl: http, IP-literal 127.0.0.1 / 10.x / 169.254.x va ichki DNS — fetch UMUMAN chaqirilmaydi", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response("x");
  }) as typeof fetch;
  const bad = [
    "http://cdn.example.com/a.png",
    "https://127.0.0.1/a.png",
    "https://10.0.0.5/a.png",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/a",
    "https://localhost/a",
    "https://internal.example.com/a",
    "https://meta.example.com/a",
    "https://mixed.example.com/a",
    "https://user:pw@cdn.example.com/a",
  ];
  for (const u of bad) {
    await assert.rejects(safeFetchUrl(u, { fetchImpl, lookup }), UnsafeUrlError, u);
  }
  assert.equal(calls, 0, "rad etilgan URL ga so'rov ketmasligi kerak");
});

test("safeFetchUrl: ichki manzilga redirect — keyingi qadam yuborilmaydi", async () => {
  for (const to of ["http://cdn.example.com/b", "https://127.0.0.1:8080/probe", "https://internal.example.com/x", "https://169.254.169.254/latest"]) {
    const hits: string[] = [];
    const fetchImpl = redirectingFetch(hits, { "https://cdn.example.com/a": to }, () => new Response(PNG));
    await assert.rejects(safeFetchUrl("https://cdn.example.com/a", { fetchImpl, lookup }), UnsafeUrlError, to);
    assert.deepEqual(hits, ["https://cdn.example.com/a"], `${to} ga so'rov ketmasligi kerak`);
  }
});

test("safeFetchUrl: ommaviy redirect kuzatiladi (≤3), 4-si rad; tana chegarasi", async () => {
  const hits: string[] = [];
  const chain = {
    "https://cdn.example.com/0": "https://cdn.example.com/1",
    "https://cdn.example.com/1": "/2",
    "https://cdn.example.com/2": "https://images.pexels.com/3",
  };
  const ok = await safeFetchUrl("https://cdn.example.com/0", { fetchImpl: redirectingFetch(hits, chain, () => new Response("salom")), lookup });
  assert.equal(await ok.text(), "salom");
  assert.deepEqual(hits, ["https://cdn.example.com/0", "https://cdn.example.com/1", "https://cdn.example.com/2", "https://images.pexels.com/3"]);

  const four = { ...chain, "https://images.pexels.com/3": "https://cdn.example.com/4" };
  await assert.rejects(safeFetchUrl("https://cdn.example.com/0", { fetchImpl: redirectingFetch([], four, () => new Response("x")), lookup }), /3 tadan ko'p/);

  const big = (async () => new Response(new Uint8Array(5000))) as unknown as typeof fetch;
  await assert.rejects(safeFetchUrl("https://cdn.example.com/big", { fetchImpl: big, lookup, maxBytes: 1000 }), /baytdan oshdi|bayt >/);
  const declared = (async () => new Response("x", { headers: { "content-length": "99999999" } })) as unknown as typeof fetch;
  await assert.rejects(safeFetchUrl("https://cdn.example.com/big", { fetchImpl: declared, lookup, maxBytes: 1000 }), /bayt >/);
});

test("fetchImageBytes: stock URL ichki manzilga redirect qilsa — rasm olinmaydi, ichki so'rov yo'q", async () => {
  const real = globalThis.fetch;
  const hits: string[] = [];
  setSafeFetchLookup(lookup);
  globalThis.fetch = redirectingFetch(hits, { "https://images.pexels.com/x.png": "http://127.0.0.1:9/probe" }, () => new Response(PNG));
  try {
    const got = await fetchImageBytes("https://images.pexels.com/x.png");
    assert.equal(got, null);
    assert.ok(!hits.includes("http://127.0.0.1:9/probe"), `ichki manzilga so'rov ketdi: ${hits.join(", ")}`);
    // Ichki DNS nomi ham — to'g'ridan-to'g'ri.
    hits.length = 0;
    assert.equal(await fetchImageBytes("https://internal.example.com/y.png"), null);
    assert.equal(hits.length, 0, "ichki xostga so'rov ketmasligi kerak");
    // Ommaviy — ishlaydi.
    const ok = await fetchImageBytes("https://cdn.example.com/ok.png");
    assert.ok(ok, "ommaviy rasm olinishi kerak");
  } finally {
    globalThis.fetch = real;
    setSafeFetchLookup(null);
  }
});

test("Aisha: javobdagi http:// yoki ichki audio havolasi yuklanmaydi", async () => {
  for (const audioUrl of ["http://cdn.example.com/a.wav", "https://10.0.0.5/a.wav", "https://internal.example.com/a.wav"]) {
    const hits: string[] = [];
    const fetchImpl = (async (url: string) => {
      hits.push(String(url));
      return hits.length === 1 ? Response.json({ audio_url: audioUrl }) : new Response(new Uint8Array(2000), { headers: { "content-type": "audio/wav" } });
    }) as typeof fetch;
    setSafeFetchLookup(lookup);
    try {
      const tts = makeAishaTts({ fetchImpl, key: () => "ak" });
      await assert.rejects(tts.synthesize("Salom dunyo", { lang: "uz", timeoutMs: 5_000 }));
      assert.equal(hits.length, 1, `${audioUrl} yuklanmasligi kerak (so'rovlar: ${hits.join(", ")})`);
    } finally {
      setSafeFetchLookup(null);
    }
  }
});

test("research getText: lex.uz HTML tanasi chegaralanadi (2 MB) — katta javob {ok:false}", async () => {
  const { getText, RESEARCH_MAX_TEXT_BYTES } = await import("../lib/generation/research/http.ts");
  const huge = (async () => new Response(new Uint8Array(RESEARCH_MAX_TEXT_BYTES + 10).fill(97), { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  const res = await getText("https://lex.uz/docs/1", { fetchImpl: huge, retries: 0 });
  assert.equal(res.ok, false, "2 MB dan katta sahifa o'qilmasligi kerak");
  const small = (async () => new Response("<h1>Qonun</h1>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  const ok = await getText("https://lex.uz/docs/1", { fetchImpl: small, retries: 0 });
  assert.ok(ok.ok && ok.text === "<h1>Qonun</h1>");
});

test("review N3: IPv4-compatible / NAT64 / uzun mapped / site-local IPv6 — ichki", () => {
  for (const ip of ["::7f00:1", "::a00:1", "64:ff9b::a00:1", "0:0:0:0:0:ffff:7f00:1", "fec0::1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test("review N4: sekin DNS umumiy timeout bilan kesiladi", async () => {
  const slow: LookupFn = () => new Promise((r) => setTimeout(() => r(["93.184.216.34"]), 5_000));
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response("x");
  }) as typeof fetch;
  const t0 = Date.now();
  await assert.rejects(safeFetchUrl("https://slow.example.com/a", { fetchImpl, lookup: slow, timeoutMs: 200 }));
  assert.ok(Date.now() - t0 < 2_000, `DNS kutildi: ${Date.now() - t0} ms`);
  assert.equal(calls, 0);
});

test("review N5: Aisha o'z xostidagi http:// havolani https ga ko'taradi; begona http rad", async () => {
  const { httpsForAisha } = await import("../lib/generation/tts/aisha.ts");
  assert.equal(httpsForAisha("http://back.aisha.group/media/tts/a.wav"), "https://back.aisha.group/media/tts/a.wav");
  assert.equal(httpsForAisha("http://cdn.example.com/a.wav"), "http://cdn.example.com/a.wav");
  const hits: string[] = [];
  const fetchImpl = (async (url: string) => {
    hits.push(String(url));
    return hits.length === 1 ? Response.json({ audio_url: "http://back.aisha.group/media/a.wav" }) : new Response(new Uint8Array(10), { headers: { "content-type": "audio/wav" } });
  }) as typeof fetch;
  setSafeFetchLookup(PUBLIC);
  try {
    // WAV emas (10 bayt) — xato, lekin ikkinchi so'rov HTTPS ga ketgan bo'lishi kerak.
    await makeAishaTts({ fetchImpl, key: () => "ak" }).synthesize("Salom", { lang: "uz", timeoutMs: 5_000 }).catch(() => null);
    assert.equal(hits[1], "https://back.aisha.group/media/a.wav");
  } finally {
    setSafeFetchLookup(null);
  }
});

test("setSafeFetchLookup(null) tizim DNS iga qaytadi (seam oqmaydi)", async () => {
  setSafeFetchLookup(PUBLIC);
  setSafeFetchLookup(null);
  // IP-literal DNS siz tekshiriladi — tarmoqsiz ham aniq javob.
  await assert.rejects(safeFetchUrl("https://127.0.0.1/"), UnsafeUrlError);
});
