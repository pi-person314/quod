// In-process route harness for worker integration checks; no listening socket.
import { db } from "@quod/contracts/db";
async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { path, body } = JSON.parse(input);
  const route = path === "/api/intel/resolve" ? await import("../app/api/intel/resolve/route")
    : path === "/api/intel/bake" ? await import("../app/api/intel/bake/route") : undefined;
  if (!route) throw new Error("Unexpected route");
  try {
    const response = await route.POST(new Request(`http://127.0.0.1${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    console.log(JSON.stringify(result));
  } finally { await db().end(); }
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
