import * as esbuild from "esbuild"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    dev: { type: "boolean", default: false },
    watch: { type: "boolean", default: false },
  },
})

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node22",
  sourcemap: values.dev || values.watch,
  minify: !values.dev && !values.watch,
  logLevel: "info",
}

if (values.watch) {
  const ctx = await esbuild.context(buildOptions)
  await ctx.watch()
  console.log("Watching for changes...")
} else {
  await esbuild.build(buildOptions)
}
