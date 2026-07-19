// Pure helpers for generating and publishing the companion Pi extension
// (`pi-terax-extension`) as an asset on the matching Sendery/terax-ai release.
//
// Pi consumes git/npm packages and installs them with `npm install --omit=dev`,
// so the published manifest must carry every runtime dependency (e.g. typebox)
// in `dependencies`, keep only the host package as a peer, and drop dev noise.

export const EXTENSION_PACKAGE_NAME = "pi-terax-extension";
export const EXTENSION_ASSET_PREFIX = `${EXTENSION_PACKAGE_NAME}_`;
export const EXTENSION_ASSET_SUFFIX = ".tgz";

// Dependencies the Pi host provides at runtime; never bundle or install them.
const HOST_PROVIDED_PEERS = new Set(["@earendil-works/pi-coding-agent"]);

function assertVersion(version) {
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error("A non-empty version string is required");
  }
  return version.trim();
}

export function extensionAssetName(version) {
  return `${EXTENSION_ASSET_PREFIX}${assertVersion(version)}${EXTENSION_ASSET_SUFFIX}`;
}

export function parseExtensionAssetVersion(assetName) {
  if (
    typeof assetName !== "string" ||
    !assetName.startsWith(EXTENSION_ASSET_PREFIX) ||
    !assetName.endsWith(EXTENSION_ASSET_SUFFIX)
  ) {
    return null;
  }
  const version = assetName.slice(
    EXTENSION_ASSET_PREFIX.length,
    -EXTENSION_ASSET_SUFFIX.length,
  );
  return version.length > 0 ? version : null;
}

export function hardenExtensionManifest(source, version) {
  const nextVersion = assertVersion(version);
  const pkg = JSON.parse(JSON.stringify(source));

  if (!pkg.pi || !Array.isArray(pkg.pi.extensions) || pkg.pi.extensions.length === 0) {
    throw new Error("The extension manifest must declare pi.extensions");
  }

  const peers = { ...(pkg.peerDependencies ?? {}) };
  const dependencies = { ...(pkg.dependencies ?? {}) };
  for (const [name, range] of Object.entries(peers)) {
    if (HOST_PROVIDED_PEERS.has(name)) continue;
    dependencies[name] = dependencies[name] ?? range;
    delete peers[name];
  }

  const hardened = {
    name: EXTENSION_PACKAGE_NAME,
    version: nextVersion,
    type: pkg.type,
    license: pkg.license,
    keywords: pkg.keywords,
    files: pkg.files,
    exports: pkg.exports,
    pi: pkg.pi,
  };
  if (Object.keys(dependencies).length > 0) hardened.dependencies = dependencies;
  if (Object.keys(peers).length > 0) hardened.peerDependencies = peers;

  for (const key of Object.keys(hardened)) {
    if (hardened[key] === undefined) delete hardened[key];
  }
  return hardened;
}
