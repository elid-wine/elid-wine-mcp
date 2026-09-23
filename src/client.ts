/**
 * Thin HTTP client for the ELID API (https://elid.wine/api).
 *
 * - Authenticated beta endpoints live under /api/v1 and need a bearer token.
 * - The Swiss-market shop search under /api/shop/ch is public.
 */

export const DEFAULT_BASE_URL = "https://elid.wine";

export class ElidApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ElidApiError";
  }
}

export interface ElidClientOptions {
  token?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  /** Retries for 503/429/network errors (all endpoints are read-only). Default 2. */
  retries?: number;
  retryDelayMs?: number;
}

type Query = Record<string, string | number | undefined>;

export class ElidClient {
  readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(opts: ElidClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.token = opts.token || undefined;
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.userAgent = opts.userAgent ?? "elid-wine";
    this.retries = opts.retries ?? 2;
    this.retryDelayMs = opts.retryDelayMs ?? 500;
  }

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  /** Public web URL for a wine page, optionally anchored to a vintage section. */
  wineUrl(baseElid: string, vintage?: string): string {
    const anchor = vintage ? `#vintage-${vintage}` : "";
    return `${this.baseUrl}/wine/${encodeURIComponent(baseElid)}${anchor}`;
  }

  /** GET /api/v1/wines */
  listWines(params: { q?: string; lwin?: string; limit?: number; after?: string }) {
    return this.request("GET", "/api/v1/wines", { query: params, auth: true });
  }

  /** GET /api/v1/wines/{elid} */
  getWine(baseElid: string) {
    return this.request("GET", `/api/v1/wines/${encodeURIComponent(baseElid)}`, { auth: true });
  }

  /** POST /api/v1/match */
  match(body: { raw: string; top_n?: number; country_code?: string; producer_id?: string }) {
    return this.request("POST", "/api/v1/match", { body, auth: true });
  }

  /** GET /api/shop/ch (public) */
  searchShop(params: Query) {
    return this.request("GET", "/api/shop/ch", { query: params });
  }

  /** GET /api/shop/ch/sites (public) */
  listShops() {
    return this.request("GET", "/api/shop/ch/sites");
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Query; body?: unknown; auth?: boolean } = {},
  ): Promise<any> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
    if (opts.auth) {
      if (!this.token) {
        throw new ElidApiError(
          "This tool needs an ELID API token. Set the ELID_API_TOKEN environment variable " +
            "(request one from rvt@elid.wine; see https://elid.wine/api).",
        );
      }
      headers.Authorization = `Bearer ${this.token}`;
    }
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    let res: Response | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if ((res.status !== 503 && res.status !== 429) || attempt >= this.retries) break;
      } catch (err) {
        if (attempt >= this.retries) {
          throw new ElidApiError(`Request to ${url.origin}${url.pathname} failed: ${(err as Error).message}`);
        }
      }
      await new Promise((r) => setTimeout(r, this.retryDelayMs * 2 ** attempt));
    }

    const text = await res.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const detail = (data && typeof data.error === "string" && data.error) || text.slice(0, 300) || res.statusText;
      const hint =
        res.status === 401
          ? " Check that ELID_API_TOKEN is set to a valid, unrevoked token."
          : res.status === 503
            ? " The service is temporarily unavailable; retry shortly."
            : "";
      throw new ElidApiError(`ELID API ${res.status}: ${detail}${hint}`, res.status);
    }
    if (data === null) {
      throw new ElidApiError(`ELID API returned a non-JSON response (${res.status}).`, res.status);
    }
    return data;
  }
}

/**
 * Split an ELID like "FR-CMP-DOMP01-2015" (or "FR-CMP-DOMP01") into base and
 * vintage/edition parts. Grape suffixes such as "+RIS" are dropped from the base.
 */
export function parseElid(input: string): { base: string; vintage?: string } {
  const parts = input.trim().toUpperCase().split("-");
  if (parts.length < 3 || parts.slice(0, 3).some((p) => !p)) {
    throw new ElidApiError(
      `"${input}" is not an ELID. Expected {CC}-{RRR}-{PPPP}{WW}[-{VINTAGE}], e.g. FR-CMP-DOMP01-2015.`,
    );
  }
  const base = parts.slice(0, 3).join("-").replace(/\+.*$/, "");
  const vintage = parts[3]?.replace(/\+.*$/, "") || undefined;
  return { base, vintage };
}
