import { basename, join } from "node:path";

const SEMVER = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
const DEFAULT_REPOSITORY = "Sendery/terax-ai";
export const REQUIRED_UPDATER_TARGETS = [
  "linux-x86_64",
  "windows-x86_64",
  "darwin-aarch64",
  "darwin-x86_64",
];

export function parseReleaseArgs(args) {
  const versionIndex = args.findIndex((arg) => SEMVER.test(arg));
  const match = versionIndex >= 0 ? args[versionIndex].match(SEMVER) : null;
  if (!match) throw new Error("The release version must be a valid semantic version");
  if (match[1].includes("-") || match[1].includes("+")) {
    throw new Error("Local publishing requires a stable semantic version");
  }
  const options = {
    version: match[1],
    repository: DEFAULT_REPOSITORY,
    target: undefined,
    publish: false,
    allowPartial: false,
    dryRun: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    if (index === versionIndex) continue;
    const arg = args[index];
    if (arg === "--draft") continue;
    if (arg === "--publish") options.publish = true;
    else if (arg === "--allow-partial") options.allowPartial = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--target") options.target = args[++index];
    else if (arg === "--repo") options.repository = args[++index];
    else throw new Error(`Unknown local release option: ${arg}`);
  }
  if (!options.repository?.includes("/")) {
    throw new Error("The release repository must use OWNER/REPO format");
  }
  if (options.publish && options.target) {
    throw new Error("--target cannot be used with --publish");
  }
  return options;
}

function architectureName(arch) {
  if (arch === "x64") return "x86_64";
  if (arch === "arm64") return "aarch64";
  return null;
}

export function platformBuildPlan({ platform, arch, target }) {
  const nativeArch = architectureName(arch);
  if (platform === "darwin") {
    const rustTarget = target ?? `${nativeArch}-apple-darwin`;
    if (!nativeArch || !["aarch64-apple-darwin", "x86_64-apple-darwin"].includes(rustTarget)) {
      throw new Error(`Unsupported local release platform: ${platform}/${arch}/${rustTarget}`);
    }
    const releaseArch = rustTarget.startsWith("aarch64") ? "aarch64" : "x86_64";
    return {
      updaterTarget: `darwin-${releaseArch}`,
      rustTarget,
      bundles: ["app", "dmg"],
      bundleRoot: join("src-tauri", "target", rustTarget, "release", "bundle"),
    };
  }
  if (target?.includes("apple-darwin")) {
    throw new Error("Apple Rust targets are only supported on macOS");
  }
  if (platform === "linux" && nativeArch === "x86_64" && !target) {
    return {
      updaterTarget: "linux-x86_64",
      rustTarget: undefined,
      bundles: ["appimage", "deb", "rpm"],
      bundleRoot: join("src-tauri", "target", "release", "bundle"),
    };
  }
  if (platform === "win32" && nativeArch === "x86_64" && !target) {
    return {
      updaterTarget: "windows-x86_64",
      rustTarget: undefined,
      bundles: ["nsis", "msi"],
      bundleRoot: join("src-tauri", "target", "release", "bundle"),
    };
  }
  throw new Error(`Unsupported local release platform: ${platform}/${arch}/${target ?? "native"}`);
}

function updaterSuffix(target) {
  if (target.startsWith("linux-")) return ".AppImage";
  if (target.startsWith("windows-")) return ".exe";
  if (target.startsWith("darwin-")) return ".app.tar.gz";
  throw new Error(`Unsupported updater target: ${target}`);
}

export function selectUpdaterPair(target, files) {
  const suffix = updaterSuffix(target);
  const artifact = files.find((file) => file.endsWith(suffix) && files.includes(`${file}.sig`));
  if (!artifact) throw new Error(`No signed updater artifact found for ${target}`);
  return { artifact, signature: `${artifact}.sig` };
}

function compoundExtension(name) {
  for (const suffix of [
    ".app.tar.gz.sig",
    ".app.tar.gz",
    ".AppImage.sig",
    ".AppImage",
    ".tar.gz.sig",
    ".tar.gz",
    ".exe.sig",
    ".msi.sig",
    ".AppImage",
    ".dmg",
    ".deb",
    ".rpm",
    ".exe",
    ".msi",
    ".sig",
  ]) {
    if (name.endsWith(suffix)) return suffix;
  }
  const dot = name.indexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

export function releaseAssetName(version, updaterTarget, file, digest) {
  if (!/^[a-f0-9]{16}$/i.test(digest ?? "")) {
    throw new Error("Release asset names require a 16-character content digest");
  }
  return `Terax_${version}_${updaterTarget}_${digest.toLowerCase()}${compoundExtension(basename(file))}`;
}

export function compatibilityAssetName(version, updaterTarget, file) {
  if (updaterTarget === "linux-x86_64" && file.endsWith(".deb")) {
    return `Terax_${version}_amd64.deb`;
  }
  if (updaterTarget === "darwin-aarch64" && file.endsWith(".app.tar.gz")) {
    return "Terax_aarch64.app.tar.gz";
  }
  if (updaterTarget === "darwin-x86_64" && file.endsWith(".app.tar.gz")) {
    return "Terax_x64.app.tar.gz";
  }
  return null;
}

export function buildUpdaterFragment({
  version,
  updaterTarget,
  assetName,
  signature,
  repository = DEFAULT_REPOSITORY,
  commit,
}) {
  if (!commit?.trim()) throw new Error("Updater fragments require a source commit");
  return {
    version,
    commit: commit.trim(),
    platforms: {
      [updaterTarget]: {
        signature: signature.trim(),
        url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(assetName)}`,
      },
    },
  };
}

export function assertSourceProvenance({ status, branch, head, remoteHead }) {
  if (status) {
    throw new Error("The entire working tree, including untracked files, must be clean before staging a release");
  }
  if (branch !== "develop") {
    throw new Error("Local releases must be staged from the develop branch");
  }
  if (head !== remoteHead) {
    throw new Error("HEAD must exactly match origin/develop before staging a release");
  }
}

export function assertReleaseCanStage(release) {
  if (release && release.draft !== true) {
    throw new Error("The release already exists and is already published");
  }
}

export function assertReleaseTargetsCommit(release, commit) {
  if (release?.target_commitish !== commit) {
    throw new Error("The draft release must target the exact source commit");
  }
}

export function assertVersionIsNewer(version, latestTag) {
  if (!latestTag) return;
  const parse = (value) => {
    const match = value.match(SEMVER);
    if (!match || match[1].includes("-") || match[1].includes("+")) {
      throw new Error(`Invalid stable release version: ${value}`);
    }
    return match[1].split(".").map(Number);
  };
  const candidate = parse(version);
  const latest = parse(latestTag);
  const changedIndex = candidate.findIndex((part, index) => part !== latest[index]);
  if (changedIndex === -1 || candidate[changedIndex] < latest[changedIndex]) {
    throw new Error(`Release version ${version} must be strictly newer than ${latestTag}`);
  }
}

function minisignKeyId(text) {
  const line = text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value));
  if (!line) throw new Error("Invalid minisign key or signature format");
  const packet = Buffer.from(line, "base64");
  if (packet.length < 10) throw new Error("Invalid minisign packet");
  return packet.subarray(2, 10).toString("hex");
}

function unwrapMinisignEnvelope(value) {
  const trimmed = value.trim();
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.startsWith("untrusted comment:")) return decoded;
  } catch {}
  return value;
}

export function assertSigningKeyMatches(encodedPublicKey, signatureText) {
  const publicText = unwrapMinisignEnvelope(encodedPublicKey);
  const decodedSignature = unwrapMinisignEnvelope(signatureText);
  if (minisignKeyId(publicText) !== minisignKeyId(decodedSignature)) {
    throw new Error("The updater signature key does not match the compiled public key");
  }
}

export function validateUpdaterFragment(fragment, context) {
  if (!REQUIRED_UPDATER_TARGETS.includes(context.expectedTarget)) {
    throw new Error(`Unknown supported updater target: ${context.expectedTarget}`);
  }
  if (fragment.version !== context.version) {
    throw new Error(`Updater fragment version ${fragment.version} does not match ${context.version}`);
  }
  if (fragment.commit !== context.commit) {
    throw new Error(`Updater fragment does not match source commit ${context.commit}`);
  }
  const targets = Object.keys(fragment.platforms ?? {});
  if (targets.length !== 1 || targets[0] !== context.expectedTarget) {
    throw new Error(`Updater fragment must contain exactly target ${context.expectedTarget}`);
  }
  const entry = fragment.platforms[context.expectedTarget];
  if (!entry?.signature?.trim() || !entry?.url) {
    throw new Error(`Incomplete updater target: ${context.expectedTarget}`);
  }
  const expectedPrefix = `https://github.com/${context.repository}/releases/download/v${context.version}/`;
  if (!entry.url.startsWith(expectedPrefix)) {
    throw new Error(`Updater URL does not use the expected GitHub release: ${entry.url}`);
  }
  const assetName = decodeURIComponent(entry.url.slice(expectedPrefix.length));
  const assetPrefix = `Terax_${context.version}_${context.expectedTarget}_`;
  const suffix = updaterSuffix(context.expectedTarget);
  const digest = assetName.slice(assetPrefix.length, -suffix.length);
  if (
    !assetName.startsWith(assetPrefix) ||
    !assetName.endsWith(suffix) ||
    !/^[a-f0-9]{16}$/i.test(digest)
  ) {
    throw new Error(`Updater asset name does not contain the required content digest: ${assetName}`);
  }
  if (!context.assetNames.has(assetName)) {
    throw new Error(`Updater URL references missing release asset: ${assetName}`);
  }
}

export function mergeUpdaterFragments(fragments, notes = "", pubDate = new Date().toISOString()) {
  if (fragments.length === 0) throw new Error("At least one updater fragment is required");
  const versions = new Set(fragments.map((fragment) => fragment.version));
  if (versions.size !== 1) throw new Error("All updater fragments must use the same version");
  const commits = new Set(fragments.map((fragment) => fragment.commit));
  if (commits.size !== 1 || !fragments[0].commit) {
    throw new Error("All updater fragments must use the same source commit");
  }
  const platforms = {};
  for (const fragment of fragments) {
    for (const [target, value] of Object.entries(fragment.platforms ?? {})) {
      if (platforms[target]) throw new Error(`Duplicate updater target: ${target}`);
      if (!value?.url || !value?.signature) {
        throw new Error(`Incomplete updater target: ${target}`);
      }
      platforms[target] = value;
    }
  }
  return {
    version: fragments[0].version,
    notes,
    pub_date: pubDate,
    platforms,
  };
}
