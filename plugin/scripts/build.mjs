// Bundles the plugin into ONE file (dist/plugin.mjs) as PayBox requires. See esbuild-common.mjs.
import { build } from "esbuild";
import { common } from "./esbuild-common.mjs";

await build({ ...common, entryPoints: ["src/plugin.ts"], outfile: "dist/plugin.mjs" });
