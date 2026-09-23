import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElidClient, type ElidClientOptions } from "../src/client.js";
import { createServer } from "../src/server.js";

export async function connect(opts: ElidClientOptions) {
  const server = createServer(new ElidClient(opts));
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const res: any = await client.callTool({ name, arguments: args });
      const text = res.content?.[0]?.text ?? "";
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {}
      return { isError: Boolean(res.isError), text, json };
    },
    close: () => client.close(),
  };
}
