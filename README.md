# elid-wine-mcp

An [MCP](https://modelcontextprotocol.io) server for **[ELID](https://elid.wine)**, which gives wines readable IDs. It lets Claude and other MCP clients:

- turn wine text such as a label or a wine-list line into ranked ELIDs
- look up wines by name, ELID prefix or LWIN
- get vintage fact sheets: alcohol, sugar, acidity, blend, soil, winemaking, aging, dosage, drinking window and food pairing
- search observed retailer prices from Swiss-market shops

An ELID is written `{CC}-{RRR}-{PPPP}{NN}[-{VINTAGE}]`. For example, `FR-CMP-DOMP01-2015` is the 2015 Dom Pérignon.

## Tools

| Tool | What it does |
| --- | --- |
| `elid_match_wine` | Matches free text to ranked base-wine ELIDs, with LWINs and scores |
| `elid_search_wines` | Searches the catalog by name/ELID substring (`q`) or exact 7-digit `lwin`, with cursor pagination |
| `elid_get_wine` | Returns a wine's identity and vintage fact sheets. A full ELID such as `…-2015` limits the facts to that vintage |
| `elid_search_shop_prices` | Searches Swiss-market shop prices by text, ELID and vintage, shop, or CHF range, with sorting |
| `elid_list_shops` | Lists covered shops with observation counts and date ranges |

Every tool is read-only, and no API key or account is needed. Results include a `wine_url` (for example `https://elid.wine/wine/FR-CMP-DOMP01#vintage-2015`) that you can cite.

## Install

Node.js 20 or newer is required.

### Claude Code

```sh
claude mcp add elid -- npx -y elid-wine-mcp
```

### Claude Desktop, Cursor, Windsurf and other clients

Add this to your MCP config file (for Claude Desktop, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "elid": {
      "command": "npx",
      "args": ["-y", "elid-wine-mcp"]
    }
  }
}
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ELID_BASE_URL` | `https://elid.wine` | Alternative deployment, e.g. `https://elid-site.exe.xyz` |

## Example

> **You:** I'm looking at "Dom Perignon 2015" on a wine list. What's in it, and what does it cost in Swiss shops?

Claude calls:

1. `elid_match_wine({ "raw": "Dom Perignon 2015" })`, which returns `FR-CMP-DOMP01` (Dom Pérignon, Vintage, Champagne; LWIN 1082656).
2. `elid_get_wine({ "elid": "FR-CMP-DOMP01-2015" })`, which returns the 2015 facts only: 12.5% ABV, 51% Pinot Noir / 49% Chardonnay, dosage 4.5 g/L, 100% malolactic, about 8 years on lees, disgorged 2023-01, drinking window 2023+.
3. `elid_search_shop_prices({ "elid": "FR-CMP-DOMP01-2015", "sort": "price" })`, which returns observed shop listings with shop, bottle size, currency and observation date.

Then it answers with the ELID, cites `https://elid.wine/wine/FR-CMP-DOMP01#vintage-2015`, and labels each price as a dated observation, not a current offer.

## Data notes

- **Don't mix vintages.** `elid_get_wine` never applies one vintage's facts to another. If a vintage has no fact sheet, the tool says so.
- **Prices are observations.** Shop rows keep the source currency, bottle size, case quantity and `scraped_at` date. Missing values are `null`. Shipping and taxes are not included, and a listed price does not mean the wine is in stock now.
- **Match scores rank candidates.** They are not probabilities. An empty list means no accepted match.
- The API does not include RRP, restaurant lists or critic reviews. For those, see the pages on [elid.wine](https://elid.wine).

## Development

```sh
npm install
npm run build
npm test                                  # unit tests (mocked HTTP)
npm run test:live                         # live tests against elid.wine
npm run inspect                           # MCP Inspector UI
```

### Publishing

1. Update `version` in `package.json` and in both places in `server.json`.
2. Run `npm publish`. The `prepublishOnly` script builds and runs the tests first.
3. Optionally, list the server in the [MCP Registry](https://registry.modelcontextprotocol.io): `mcp-publisher login github && mcp-publisher publish`.

You can also publish a GitHub release. `.github/workflows/publish.yml` then publishes to npm (this needs an `NPM_TOKEN` secret) and to the MCP Registry.

## License

MIT. Data © ELID. The catalog comes partly from LWIN (CC BY 4.0); see [elid.wine](https://elid.wine) for provenance.
