// build.config.ts
// esbuild multi-entry build for MV3 Chrome extension.
// Three independent bundles: background SW, content script, popup.

import * as esbuild from "esbuild";
import * as path from "path";
import * as fs from "fs/promises";

const isDev = process.argv.includes("--dev");
const outdir = "dist";

const sharedOptions: esbuild.BuildOptions = {
  bundle: true,
  format: "esm",
  target: ["chrome120"],
  sourcemap: isDev ? "inline" : false,
  minify: !isDev,
  outdir,
  logLevel: "info",
};

async function build(): Promise<void> {
  // Ensure dist/ exists.
  await fs.mkdir(outdir, { recursive: true });

  // Copy static assets.
  await fs.copyFile("src/popup/popup.html", path.join(outdir, "popup.html"));
  await fs.copyFile("src/popup/popup.css", path.join(outdir, "popup.css"));
  await fs.cp("src/_locales", path.join(outdir, "_locales"), { recursive: true });
  await fs.cp("icons", path.join(outdir, "icons"), { recursive: true });
  await fs.copyFile("manifest.json", path.join(outdir, "manifest.json"));

  // Build JS bundles in parallel.
  await Promise.all([
    esbuild.build({
      ...sharedOptions,
      entryPoints: { background: "src/background/service-worker.ts" },
    }),
    esbuild.build({
      ...sharedOptions,
      entryPoints: { content: "src/content/content.ts" },
    }),
    esbuild.build({
      ...sharedOptions,
      entryPoints: { popup: "src/popup/popup.ts" },
    }),
  ]);

  console.log(`\n✓ Build complete → ${outdir}/`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
