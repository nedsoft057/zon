// Builds test/bench-entry.ts with the same bundler settings as the plugin, then runs it in a
// fresh process per network (like PayBox's fresh sandbox) and reports the bundle size and timing.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { common } from "./esbuild-common.mjs";

await build({ ...common, entryPoints: ["test/bench-entry.ts"], outfile: "dist/bench.mjs" });
const results = [];
for (const net of process.argv.slice(2).length ? process.argv.slice(2) : ["arbitrum-sepolia", "arbitrum"]) {
  for (let run = 1; run <= 3; run++) {
    const t0 = Date.now();
    try {
      const out = execFileSync(process.execPath, ["dist/bench.mjs", net], { encoding: "utf8", timeout: 60_000 });
      results.push({ net, run, process_ms: Date.now() - t0, ...JSON.parse(out.trim().split("\n").pop()) });
    } catch (e) {
      results.push({ net, run, process_ms: Date.now() - t0, error: String(e.stderr || e.message).slice(0, 600) });
    }
  }
}
const pluginBytes = (() => { try { return statSync("dist/plugin.mjs").size; } catch { return null; } })();
console.log(JSON.stringify({ plugin_bundle_bytes: pluginBytes, limit_bytes: 10 * 1024 * 1024, results }, null, 2));
