import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { compareCosts, Measurement } from "../cost-comparison";

const [baselinePath, optimizedPath] = process.argv.slice(2);
if (!baselinePath || !optimizedPath) throw new Error("Usage: cost-compare BASELINE.json OPTIMIZED.json");
for (const path of [baselinePath, optimizedPath]) {
  if (!path.endsWith(".json") || basename(path).startsWith(".env")) throw new Error("Measurement JSON files are required");
}
const [baseline, optimized] = await Promise.all([baselinePath, optimizedPath].map(async (path) => Measurement.parse(JSON.parse(await readFile(path, "utf8")))));
console.log(JSON.stringify(compareCosts(baseline, optimized), null, 2));
