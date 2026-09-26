#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ElidClient } from "./client.js";
import { createServer, SERVER_VERSION } from "./server.js";

async function main() {
  const client = new ElidClient({
    baseUrl: process.env.ELID_BASE_URL,
    userAgent: `elid-wine-mcp/${SERVER_VERSION}`,
  });
  const server = createServer(client);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[elid-wine-mcp] fatal:", err);
  process.exit(1);
});
