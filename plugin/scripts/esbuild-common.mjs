// Bundles the plugin into ONE file (dist/plugin.mjs) as PayBox requires.
// Fhenix's node-tfhe loads a .wasm file from disk at runtime; a single-file bundle has no disk,
// so this inlines the wasm (gzip + base64) and swaps the disk read for an in-memory decode.
// The output is deterministic: same inputs, same bytes.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";

const inlineWasm = {
  name: "inline-node-tfhe-wasm",
  setup(b) {
    b.onLoad({ filter: /node-tfhe[\\/][^\\/]*\.js$/ }, (args) => {
      let src = readFileSync(args.path, "utf8");
      const wasmPath = join(dirname(args.path), "tfhe_bg.wasm");
      let wasm;
      try { wasm = readFileSync(wasmPath); } catch { return { contents: src, loader: "js" }; }
      const b64 = gzipSync(wasm, { level: 9, mtime: 0 }).toString("base64");
      const pattern = /require\((['"])fs\1\)\.readFileSync\(\s*([A-Za-z_$][\w$]*)\s*\)/;
      if (!pattern.test(src)) throw new Error(`node-tfhe loader changed; cannot inline wasm in ${args.path}`);
      src = src.replace(pattern, `require("zlib").gunzipSync(Buffer.from(${JSON.stringify(b64)}, "base64"))`);
      return { contents: src, loader: "js" };
    });
  },
};

export const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: true,
  legalComments: "none",
  // CommonJS dependencies (node-tfhe) need a real `require`, `__filename` and `__dirname` inside an ES module bundle.
  // (node-tfhe still builds a wasm path from `__dirname` even though the read itself is inlined above.)
  banner: {
    js: 'import{createRequire as __cr}from"node:module";import{fileURLToPath as __fu}from"node:url";import{dirname as __dn}from"node:path";' +
      "const require=__cr(import.meta.url),__filename=__fu(import.meta.url),__dirname=__dn(__filename);",
  },
  plugins: [inlineWasm],
  logLevel: "warning",
};
