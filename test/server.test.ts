import assert from "node:assert/strict";
import { test } from "node:test";
import { parseElid } from "../src/client.js";
import { connect } from "./helpers.js";

type Seen = { url: URL; init: RequestInit };

function mockFetch(routes: Record<string, (s: Seen) => [number, unknown]>) {
  const seen: Seen[] = [];
  const f = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const s = { url, init };
    seen.push(s);
    const handler = routes[`${init.method ?? "GET"} ${url.pathname}`];
    const [status, body] = handler ? handler(s) : [404, { error: "not found" }];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, seen };
}

const DOMP = {
  data: {
    elid: "FR-CMP-DOMP01",
    display_name: "Dom Pérignon, Vintage, Champagne",
    lwin: "1082656",
    facts: [
      { vintage: "2017", alcohol_percent: 12.5 },
      { vintage: "2015", alcohol_percent: 12.5, dosage: "4.5 g/L" },
    ],
  },
};

test("parseElid splits base and vintage", () => {
  assert.deepEqual(parseElid("fr-cmp-domp01-2015"), { base: "FR-CMP-DOMP01", vintage: "2015" });
  assert.deepEqual(parseElid("FR-CMP-DOMP01"), { base: "FR-CMP-DOMP01", vintage: undefined });
  assert.deepEqual(parseElid("DE-MOS-EGMU01+RIS-NVXX"), { base: "DE-MOS-EGMU01", vintage: "NVXX" });
  assert.throws(() => parseElid("dom perignon"));
});

test("lists all five tools with read-only annotations", async () => {
  const s = await connect({ fetch: mockFetch({}).f });
  const { tools } = await s.client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "elid_get_wine",
    "elid_list_shops",
    "elid_match_wine",
    "elid_search_shop_prices",
    "elid_search_wines",
  ]);
  for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true);
  await s.close();
});

test("match sends a JSON body without credentials, adds wine_url", async () => {
  const m = mockFetch({
    "POST /api/v1/match": () => [200, { data: [{ elid: "ZA-STB-KNKP01", score: 0.8 }], snapshot: "x" }],
  });
  const s = await connect({ fetch: m.f });
  const r = await s.call("elid_match_wine", { raw: "Kanonkop Paul Sauer 2021", top_n: 3, country_code: "za" });
  assert.equal(r.isError, false);
  assert.equal(r.json.data[0].wine_url, "https://elid.wine/wine/ZA-STB-KNKP01");
  const { init, url } = m.seen[0];
  assert.equal((init.headers as any).Authorization, undefined);
  assert.equal(url.search, "", "match parameters belong in the body, not the URL");
  assert.deepEqual(JSON.parse(String(init.body)), { raw: "Kanonkop Paul Sauer 2021", top_n: 3, country_code: "ZA" });
  await s.close();
});

test("get_wine with a full ELID restricts facts to that vintage", async () => {
  const m = mockFetch({ "GET /api/v1/wines/FR-CMP-DOMP01": () => [200, DOMP] });
  const s = await connect({ fetch: m.f });
  const r = await s.call("elid_get_wine", { elid: "FR-CMP-DOMP01-2015" });
  assert.equal(r.isError, false);
  assert.deepEqual(r.json.facts, [DOMP.data.facts[1]]);
  assert.deepEqual(r.json.available_vintages, ["2017", "2015"]);
  assert.equal(r.json.wine_url, "https://elid.wine/wine/FR-CMP-DOMP01#vintage-2015");

  const missing = await s.call("elid_get_wine", { elid: "FR-CMP-DOMP01", vintage: "1999" });
  assert.deepEqual(missing.json.facts, []);
  assert.match(missing.json.note, /Do not apply other vintages/);
  await s.close();
});

test("API errors surface as tool errors with status", async () => {
  const m = mockFetch({ "GET /api/v1/wines/FR-CMP-NOPE01": () => [404, { error: "Wine not found." }] });
  const s = await connect({ fetch: m.f });
  const r = await s.call("elid_get_wine", { elid: "FR-CMP-NOPE01" });
  assert.equal(r.isError, true);
  assert.match(r.text, /ELID API 404: Wine not found\./);
  await s.close();
});

test("shop search is public, splits ELID vintage and defaults limit", async () => {
  const m = mockFetch({
    "GET /api/shop/ch": () => [
      200,
      { rows: [{ elid: "FR-CMP-DOMP01", elid_url: "/wine/FR-CMP-DOMP01", price_raw: "1 181.00 CHF" }], total: 1 },
    ],
  });
  const s = await connect({ fetch: m.f });
  const r = await s.call("elid_search_shop_prices", { elid: "FR-CMP-DOMP01-2015", sort: "price" });
  assert.equal(r.isError, false);
  const { url, init } = m.seen[0];
  assert.equal(url.searchParams.get("elid"), "FR-CMP-DOMP01");
  assert.equal(url.searchParams.get("vintage"), "2015");
  assert.equal(url.searchParams.get("sort"), "price");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal((init.headers as any).Authorization, undefined);
  assert.equal(r.json.rows[0].wine_url, "https://elid.wine/wine/FR-CMP-DOMP01");
  assert.equal(r.json.rows[0].elid_url, undefined);
  await s.close();
});

test("custom base URL is respected", async () => {
  const m = mockFetch({ "GET /api/shop/ch/sites": () => [200, { sites: [] }] });
  const s = await connect({ baseUrl: "https://elid-site.exe.xyz/", fetch: m.f });
  await s.call("elid_list_shops");
  assert.equal(m.seen[0].url.origin, "https://elid-site.exe.xyz");
  await s.close();
});

test("retries 503 with backoff, then succeeds", async () => {
  let n = 0;
  const m = mockFetch({
    "GET /api/shop/ch/sites": () => (++n < 3 ? [503, { error: "busy" }] : [200, { sites: [{ site: "a.ch" }] }]),
  });
  const s = await connect({ fetch: m.f, retryDelayMs: 1 });
  const r = await s.call("elid_list_shops");
  assert.equal(r.isError, false, r.text);
  assert.equal(m.seen.length, 3);
  await s.close();
});

test("gives up after retries and reports 503", async () => {
  const m = mockFetch({ "GET /api/shop/ch/sites": () => [503, { error: "busy" }] });
  const s = await connect({ fetch: m.f, retryDelayMs: 1, retries: 1 });
  const r = await s.call("elid_list_shops");
  assert.equal(r.isError, true);
  assert.match(r.text, /503: busy The service is temporarily unavailable/);
  assert.equal(m.seen.length, 2);
  await s.close();
});
