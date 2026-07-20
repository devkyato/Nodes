import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = resolve(root, "dist");
const files = ["index.html", "style.css", "script.js", "humans.txt", "og.png", "robots.txt", "site.webmanifest", "sitemap.xml"];

if (dirname(output) !== root) throw new Error("Refusing to build outside the project root");

await rm(output, { recursive: true, force: true });
await mkdir(output);
await Promise.all(files.map((file) => copyFile(join(root, file), join(output, file))));

console.log(`Built the static application and discovery assets in dist/`);
