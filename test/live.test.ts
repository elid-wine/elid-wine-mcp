// Live tests against the real API. Run with: ELID_API_TOKEN=... npm run test:live
import assert from "node:assert/strict";
import { test } from "node:test";
import { connect } from "./helpers.js";

const token = process.env.ELID_API_TOKEN;
const live = process.env.ELID_LIVE === "1";
const opts = { skip: !live ? "set ELID_LIVE=1 (npm run test:live)" : undefined };
const authOpts = { skip: opts.skip ?? (!token ? "ELID_API_TOKEN not set" : undefined) };
const baseUrl = process.env.ELID_BASE_URL;

test("live: match Kanonkop Paul Sauer", authOpts, async () => {
  const s = await connect({ token, baseUrl });
  const r = await s.call("elid_match_wine", { raw: "Kanonkop Paul Sauer 2021", top_n: 3 });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.json.data[0].elid, "ZA-STB-KNKP01");
  await s.close();
});

test("live: LWIN lookup and substring search", authOpts, async () => {
  const s = await connect({ token, baseUrl });
  const byLwin = await s.call("elid_search_wines", { lwin: "1082656" });
  assert.equal(byLwin.isError, false, byLwin.text);
  assert.equal(byLwin.json.data[0].elid, "FR-CMP-DOMP01");
  const byQ = await s.call("elid_search_wines", { q: "FR-CMP-DOMP", limit: 2 });
  assert.equal(byQ.json.data.length, 2);
  assert.ok(byQ.json.next_cursor);
  await s.close();
});

test("live: vintage facts for Dom Pérignon 2015", authOpts, async () => {
  const s = await connect({ token, baseUrl });
  const r = await s.call("elid_get_wine", { elid: "FR-CMP-DOMP01-2015" });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.json.facts.length, 1);
  assert.equal(r.json.facts[0].vintage, "2015");
  await s.close();
});

test("live: invalid token is rejected", opts, async () => {
  const s = await connect({ token: "elid_invalid", baseUrl });
  const r = await s.call("elid_search_wines", { limit: 1 });
  assert.equal(r.isError, true);
  assert.match(r.text, /401/);
  await s.close();
});

test("live: public shop search and shop list", opts, async () => {
  const s = await connect({ baseUrl });
  const prices = await s.call("elid_search_shop_prices", { q: "dom perignon", limit: 3, sort: "price" });
  assert.equal(prices.isError, false, prices.text);
  assert.ok(prices.json.total > 0);
  const shops = await s.call("elid_list_shops");
  assert.ok(shops.json.sites.length > 5);
  await s.close();
});
