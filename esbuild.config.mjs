import esbuild from "esbuild";
import { sassPlugin } from "esbuild-sass-plugin";
import { rmSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.argv.includes("production");
const outDir = resolve(__dirname, "dist");
const outFile = resolve(__dirname, "main.js");

await esbuild.build({
	entryPoints: [resolve(__dirname, "src/main.ts")],
	bundle: true,
	sourcemap: !isProd,
	platform: "browser",
	format: "cjs",
	target: "es2020",
	external: ["obsidian"],
	outfile: outFile,
	plugins: [sassPlugin()]
});

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
	copyFileSync(resolve(__dirname, file), resolve(outDir, file));
}

