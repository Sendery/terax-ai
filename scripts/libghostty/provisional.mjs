export function provisionalPin(source, manifest, host) {
  for (const key of ["crateVersion", "commit", "zigVersion"]) {
    if (source[key] !== manifest[key]) throw new Error("provisional source identity mismatch");
  }
  if (host !== "aarch64-macos" || manifest.host !== host || manifest.rustTarget !== "aarch64-apple-darwin") {
    throw new Error("provisional archive does not support this host");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256 ?? "")) throw new Error("invalid provisional checksum");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.archiveRoot ?? "")) throw new Error("invalid provisional archive root");
  return {
    ...source,
    releaseTag: `${source.releaseTag}-provisional`,
    targets: { [host]: { rustTarget: manifest.rustTarget, sha256: manifest.sha256 } },
  };
}
