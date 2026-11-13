import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
const base = process.env.VITE_BASE_PATH || "/EZPZ-Label-Studio/";
if (!/^\/[A-Za-z0-9_./-]*\/$/.test(base))
  throw Error("VITE_BASE_PATH must be an absolute site path ending in /.");
for (const [entry, args] of [
  ["node_modules/typescript/bin/tsc", ["-b"]],
  [
    "node_modules/vite/bin/vite.js",
    ["build", "--base", base, "--outDir", "dist-web"],
  ],
]) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const [source, name] of [
  ["LICENSE", "LICENSE.txt"],
  ["NOTICE", "NOTICE.txt"],
  ["COMMERCIAL.md", "COMMERCIAL.md"],
  ["THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt"],
])
  await fs.copyFile(source, `dist-web/${name}`);
await fs.writeFile("dist-web/.nojekyll", "");
