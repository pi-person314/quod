// Custom server provides same-origin, bounded streaming audio beside Next routes.
import { requireUser } from "../lib/auth";
import { requireDocumentOwner } from "../lib/data";
import { createServer } from "node:http";
import next from "next";
import { attachVoiceRelay } from "@quod/intel/voice/relay";
import { dataset } from "../lib/data";
async function main() {
const args = process.argv.slice(2);
const portIndex = args.findIndex(arg => arg === "--port" || arg === "-p");
const port = Number((portIndex >= 0 ? args[portIndex + 1] : args.find(arg => /^\d+$/.test(arg))) ?? process.env.PORT ?? 3003);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
const hostname = "127.0.0.1";
const app = next({ dev: args.includes("--dev"), hostname, port, dir: process.cwd() });
await app.prepare();
process.env.QUOD_VOICE_RELAY = "1";
process.env.QUOD_VOICE_RELAY ??= process.env.CAIRN_VOICE_RELAY ?? "1";
process.env.CAIRN_VOICE_RELAY ??= process.env.QUOD_VOICE_RELAY;
const handle = app.getRequestHandler();
const server = createServer((request, response) => { void handle(request, response); });
attachVoiceRelay(server, async (input, request) => {
  const user = await requireUser(new Request(`http://${hostname}:${port}${request.url}`, {
    headers: { cookie: request.headers.cookie ?? "" },
  }));
  await requireDocumentOwner(user, input.doc_id);
  const data = await dataset();
  const ids = new Set(input.visible_node_ids);
  const nodes = data.nodes.filter(node => node.doc_id === input.doc_id && node.page === input.page && ids.has(node.id));
  if (ids.size !== input.visible_node_ids.length || nodes.length !== ids.size) throw new Error("Invalid viewport");
  return { corpusId: data.docs.find(doc => doc.id === input.doc_id)!.corpus_id, fixture: data.fixture };
});
const upgrade = app.getUpgradeHandler();
server.on("upgrade", (request, socket, head) => {
  if (request.url?.split("?")[0] !== "/api/intel/voice/stream") void upgrade(request, socket, head);
});
server.listen(port, hostname, () => console.log(`Quod ready at http://${hostname}:${port}`));
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
