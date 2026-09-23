#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ElidClient } from "./client.js";
import { createServer, SERVER_VERSION } from "./server.js";

async function main() {
  const client = new ElidClient({
    token: process.env.ELID_API_TOKEN,
    baseUrl: process.env.ELID_BASE_URL,
    userAgent: `elid-mcp/${SERVER_VERSION}`,
  });
  if (!client.hasToken) {
    console.error(
      "[elid-mcp] ELID_API_TOKEN is not set: only the public shop-price tools will work. See https://elid.wine/api.",
    );
  }
  const server = createServer(client);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[elid-mcp] fatal:", err);
  process.exit(1);
});
