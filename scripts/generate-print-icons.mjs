import { readdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Freeze the installed, licensed Lucide pack into one offline, lazy-loaded asset.
// No icon service or thousands of individual runtime imports are needed.
const root = path.resolve("node_modules/lucide-react");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const directory = path.join(root, "dist/esm/icons");
const icons = new Map();
const canonical = new Map();
const aliases = new Map();
for (const file of (await readdir(directory)).filter(name => name.endsWith(".mjs"))) {
  const { __iconData: data } = await import(pathToFileURL(path.join(directory, file)).href);
  const fileName = file.slice(0, -4);
  if (!data) {
    const source = await readFile(path.join(directory, file), "utf8");
    const target = /from ['"]\.\/([a-z0-9-]+)\.mjs['"]/.exec(source)?.[1];
    if (target) aliases.set(fileName, target);
    continue;
  }
  if (!/^[a-z0-9-]+$/.test(data.name) || data.size !== 24 || !Array.isArray(data.node))
    throw Error(`Unexpected Lucide metadata in ${file}. Review the generator before upgrading.`);
  icons.set(data.name, {
    id: data.name,
    node: data.node.map(([tag, attributes]) => {
      if (!["path", "circle", "ellipse", "line", "polyline", "polygon", "rect"].includes(tag))
        throw Error(`Unsupported icon primitive: ${tag}`);
      const { key: _key, ...attrs } = attributes;
      if (Object.values(attrs).some(value => !["string", "number"].includes(typeof value)))
        throw Error(`Invalid icon attributes in ${file}`);
      return [tag, attrs];
    }),
  });
  canonical.set(fileName, data.name);
}
function resolveAlias(name, seen = new Set()) {
  if (canonical.has(name)) return canonical.get(name);
  if (seen.has(name)) throw Error(`Cyclic icon alias: ${name}`);
  seen.add(name);
  return aliases.has(name) ? resolveAlias(aliases.get(name), seen) : undefined;
}
for (const alias of aliases.keys()) {
  const target = resolveAlias(alias);
  if (!target) throw Error(`Missing icon alias target: ${alias}`);
  const icon = icons.get(target);
  (icon.aliases ??= []).push(alias);
}
for (const icon of icons.values()) icon.aliases?.sort((a, b) => a.localeCompare(b, "en"));
const sorted = [...icons.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
if (sorted.length < 1500) throw Error("The icon catalog is incomplete.");
await writeFile("src/print-icons.json", JSON.stringify({ provider: "Lucide", version, icons: sorted }) + "\n");
process.stdout.write(`Bundled ${sorted.length} Lucide ${version} icons.\n`);
