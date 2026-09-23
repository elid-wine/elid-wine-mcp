import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ElidClient, parseElid } from "./client.js";

export const SERVER_NAME = "elid";
export const SERVER_VERSION: string = createRequire(import.meta.url)("../package.json").version;

const INSTRUCTIONS = `ELID (https://elid.wine) gives wines human-readable identifiers: {CC}-{RRR}-{PPPP}{WW} for a base wine, plus an optional -{VINTAGE} suffix (a year, NVXX for non-vintage, or N### for an edition). Example: FR-CMP-DOMP01-2015 is the 2015 Dom Pérignon.

Typical flow: elid_match_wine turns free text (a label, a wine-list line) into ranked ELIDs; elid_get_wine returns identity and vintage-specific technical facts; elid_search_shop_prices finds observed Swiss-market retailer prices.

Guidance:
- Never invent ELIDs. Only use codes returned by these tools.
- Never apply one vintage's facts to another vintage.
- Shop prices are historical observations: always state vintage, bottle size, currency, shop and observation date. They are not guarantees of current availability.
- Cite the wine page URL (wine_url) so others can resolve the same wine, and keep ELIDs in structured answers.`;

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

export function createServer(client: ElidClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  const withUrl = <T extends { elid?: string }>(row: T) =>
    row && row.elid ? { ...row, wine_url: client.wineUrl(row.elid) } : row;

  server.registerTool(
    "elid_match_wine",
    {
      title: "Match wine text to ELIDs",
      description:
        "Match free wine text (e.g. 'Kanonkop Paul Sauer 2021', a label or a wine-list line) to ranked ELID base-wine identities. " +
        "Returns elid, lwin, display_name, producer_name, wine and scores (for ranking only, not probabilities). " +
        "An empty list means no accepted match. Vintages in the text are not part of the result: pass the vintage to elid_get_wine. Requires ELID_API_TOKEN.",
      inputSchema: {
        raw: z.string().min(1).max(500).describe("Wine text to match, up to 500 characters."),
        top_n: z.number().int().min(1).max(20).optional().describe("Number of candidates, 1–20 (default 5)."),
        country_code: z
          .string()
          .regex(/^[A-Za-z]{2}$/)
          .optional()
          .describe("Optional two-letter country code to restrict matching, e.g. ZA."),
        producer_id: z.string().optional().describe("Optional ELID producer code, e.g. ZA-KNKP."),
      },
      annotations: { title: "Match wine text", ...READ_ONLY },
    },
    ({ raw, top_n, country_code, producer_id }) =>
      run(async () => {
        const res = await client.match({
          raw,
          top_n,
          country_code: country_code?.toUpperCase(),
          producer_id: producer_id?.toUpperCase(),
        });
        return { ...res, data: (res.data ?? []).map(withUrl) };
      }),
  );

  server.registerTool(
    "elid_search_wines",
    {
      title: "Search the ELID catalog",
      description:
        "List ELID wine identities, ordered by ELID. Use q for a case-insensitive substring match on the name or ELID " +
        "(e.g. 'kanonkop' or 'FR-CMP-DOMP'), or lwin for an exact seven-digit LWIN lookup. " +
        "For free text such as a full label, prefer elid_match_wine. Paginate by passing next_cursor as after. Requires ELID_API_TOKEN.",
      inputSchema: {
        q: z.string().max(200).optional().describe("Substring of the wine name or ELID."),
        lwin: z
          .string()
          .regex(/^\d{7}$/)
          .optional()
          .describe("Exact seven-digit wine-level LWIN."),
        limit: z.number().int().min(1).max(200).optional().describe("Results per page, 1–200 (default 50)."),
        after: z.string().optional().describe("next_cursor from the previous page. Keep other filters unchanged."),
      },
      annotations: { title: "Search catalog", ...READ_ONLY },
    },
    (args) =>
      run(async () => {
        const res = await client.listWines(args);
        return { ...res, data: (res.data ?? []).map(withUrl) };
      }),
  );

  server.registerTool(
    "elid_get_wine",
    {
      title: "Get wine identity and vintage facts",
      description:
        "Get one wine's catalog identity (producer, region, colour, type, classification, LWIN…) and its vintage fact sheets " +
        "(alcohol, residual sugar, acidity, blend, soil, winemaking, aging, dosage, drinking window, food pairing…). " +
        "Accepts a base ELID (FR-CMP-DOMP01) or a full ELID with vintage (FR-CMP-DOMP01-2015), which restricts facts to that vintage. " +
        "Unknown fields are omitted. Does not include prices; use elid_search_shop_prices. Requires ELID_API_TOKEN.",
      inputSchema: {
        elid: z.string().min(1).describe("Base or full ELID, e.g. FR-CMP-DOMP01 or FR-CMP-DOMP01-2015."),
        vintage: z
          .string()
          .optional()
          .describe("Optional vintage (year, NVXX, or edition) to restrict facts to. Overrides a suffix in elid."),
      },
      annotations: { title: "Get wine", ...READ_ONLY },
    },
    ({ elid, vintage }) =>
      run(async () => {
        const parsed = parseElid(elid);
        const wanted = vintage?.trim().toUpperCase() || parsed.vintage;
        const res = await client.getWine(parsed.base);
        const wine = res.data ?? res;
        const facts: any[] = Array.isArray(wine.facts) ? wine.facts : [];
        const available_vintages = facts.map((f) => f.vintage);

        if (!wanted) {
          return { ...wine, wine_url: client.wineUrl(parsed.base), available_vintages };
        }
        const match = facts.filter((f) => String(f.vintage).toUpperCase() === wanted);
        return {
          ...wine,
          facts: match,
          requested_vintage: wanted,
          wine_url: client.wineUrl(parsed.base, wanted),
          available_vintages,
          ...(match.length === 0 && {
            note: `No fact sheet for vintage ${wanted}. Do not apply other vintages' facts to it.`,
          }),
        };
      }),
  );

  server.registerTool(
    "elid_search_shop_prices",
    {
      title: "Search Swiss-market shop prices",
      description:
        "Search observed retailer prices from ~26 Swiss-market shops (plus gute-weine.de). Filter by free text (q), exact base ELID (elid) " +
        "and vintage, shop (site), and CHF price range. Rows keep the source currency, bottle size, case quantity and observation date (scraped_at); " +
        "missing values are null. These are historical observations, not current offers; shipping and taxes are not included. " +
        "Always report vintage, size, currency, shop and date. Public, no token needed.",
      inputSchema: {
        q: z.string().optional().describe("Free-text search, accent-insensitive, e.g. 'dom perignon 2015'."),
        elid: z.string().optional().describe("Base ELID (vintage suffix is stripped and used as vintage if not given)."),
        vintage: z.string().optional().describe("Vintage year, e.g. 2015."),
        site: z.string().optional().describe("Shop domain, e.g. gute-weine.de. See elid_list_shops."),
        min: z.number().min(0).optional().describe("Minimum per-bottle price in CHF."),
        max: z.number().min(0).optional().describe("Maximum per-bottle price in CHF."),
        sort: z
          .enum([
            "recent",
            "oldest",
            "price",
            "price_desc",
            "name",
            "name_desc",
            "vintage",
            "vintage_desc",
            "site",
            "site_desc",
          ])
          .optional()
          .describe("Sort order (default recent)."),
        limit: z.number().int().min(1).max(100).optional().describe("Rows per page, 1–100 (default 20)."),
        offset: z.number().int().min(0).optional().describe("Pagination offset."),
      },
      annotations: { title: "Search shop prices", ...READ_ONLY },
    },
    ({ elid, vintage, limit, ...rest }) =>
      run(async () => {
        let baseElid: string | undefined;
        if (elid) {
          const parsed = parseElid(elid);
          baseElid = parsed.base;
          vintage ??= parsed.vintage;
        }
        const res = await client.searchShop({ ...rest, elid: baseElid, vintage, limit: limit ?? 20 });
        const rows = (res.rows ?? []).map((row: any) => {
          const { elid_url, ...r } = row;
          return r.elid ? { ...r, wine_url: client.wineUrl(r.elid) } : r;
        });
        return { ...res, rows };
      }),
  );

  server.registerTool(
    "elid_list_shops",
    {
      title: "List Swiss-market shops",
      description:
        "List the shops covered by elid_search_shop_prices, with observation counts and the oldest/newest observation dates. Public, no token needed.",
      inputSchema: {},
      annotations: { title: "List shops", ...READ_ONLY },
    },
    () => run(() => client.listShops()),
  );

  return server;
}
