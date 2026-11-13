import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const config = JSON.parse(
  await fs.readFile("src-tauri/tauri.conf.json", "utf8"),
);
const out = "output/windows";
await fs.mkdir(out, { recursive: true });
const sources = [
  ["src-tauri/target/release/ezpz-label-studio.exe", "EZPZ Label Studio.exe"],
  [
    `src-tauri/target/release/bundle/nsis/EZPZ Label Studio_${config.version}_x64-setup.exe`,
    "EZPZ Label Studio Setup.exe",
  ],
];
const artifacts = [];
for (const [source, preferredFile] of sources) {
  let file = preferredFile;
  const bytes = await fs.readFile(source);
  try {
    await fs.writeFile(path.join(out, file), bytes);
  } catch (error) {
    // A running setup/app holds an executable open on Windows. Preserve it and
    // publish the new release separately rather than interrupting the process.
    if (!["EBUSY", "EPERM", "EACCES"].includes(error.code)) throw error;
    file = `EZPZ Label Studio ${config.version}${preferredFile.includes("Setup") ? " Setup" : ""}.exe`;
    await fs.writeFile(path.join(out, file), bytes);
  }
  artifacts.push({
    file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await fs.copyFile(
  "THIRD_PARTY_NOTICES.txt",
  path.join(out, "THIRD_PARTY_NOTICES.txt"),
);
await fs.copyFile("README.md", path.join(out, "README.md"));
for (const name of ["LICENSE", "NOTICE", "COMMERCIAL.md"]) {
  await fs.copyFile(name, path.join(out, name));
}
const receipt = {
  built: new Date().toISOString(),
  product: config.productName,
  version: config.version,
  profile: "optimized release with embedded production assets",
  architecture: "Windows x64",
  webviewInstallMode: config.bundle.windows.webviewInstallMode.type,
  installerInstalledDuringValidation: false,
  validationReports: ["docs/frontend-testing.md", "docs/native-testing.md"],
  artifacts,
};
await fs.writeFile(
  path.join(out, `build-receipt-${config.version}.json`),
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt, null, 2));
