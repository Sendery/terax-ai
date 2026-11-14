import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyChecksum } from "./core.mjs";

const NOTICES = fileURLToPath(new URL("./licenses/", import.meta.url));

export function validateLicenseBundle(pin, manifest, readNotice, readSource) {
  if (pin.commit !== manifest.ghosttyCommit || pin.zigVersion !== manifest.zigVersion) {
    throw new Error("source or Zig pin changed: review and repin dependency licenses before building");
  }
  if (!manifest.files?.length || !manifest.sourceChecks?.length) throw new Error("empty license manifest");
  const seen = new Set();
  for (const entry of [...manifest.files, ...manifest.sourceChecks]) {
    if (typeof entry.path !== "string" || !entry.path || entry.path.includes("\\") || entry.path.includes(":") || entry.path.startsWith("/") || posix.normalize(entry.path) !== entry.path || entry.path.startsWith("../")) {
      throw new Error("invalid license manifest path");
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("invalid license checksum");
  }
  for (const entry of manifest.files) {
    if (seen.has(entry.path)) throw new Error("duplicate license manifest path");
    seen.add(entry.path);
    verifyChecksum(readNotice(entry.path), entry.sha256);
  }
  for (const entry of manifest.sourceChecks) verifyChecksum(readSource(entry.path), entry.sha256);
}

export function loadLicenseBundle(pin, source) {
  const manifestBytes = readFileSync(join(NOTICES, "manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const contents = new Map();
  validateLicenseBundle(pin, manifest, (path) => {
    const bytes = readFileSync(join(NOTICES, path));
    contents.set(path, bytes);
    return bytes;
  }, (path) => readFileSync(join(source, path)));
  return { manifestBytes, contents };
}

export function writeLicenseBundle(bundle, directory) {
  mkdirSync(directory, { recursive: true });
  for (const [path, contents] of bundle.contents) {
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  }
  writeFileSync(join(directory, "manifest.json"), bundle.manifestBytes);
}
