import { digest } from "./variant.mjs";

const capabilities = ["ghostty_terminal_set_scrollback_limit_rows", "ghostty_terminal_clear_preserving_cursor_row"];
const checksum = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
export function receiptForHost(source, receipt, host) {
  if (host === receipt.host) return receipt;
  const target = source.nativeCoreTargets?.[host];
  if (!target) throw new Error("native core archive does not support this host");
  if (target.sha256 === null) throw new Error(`native core archive is unavailable for ${host}: ${target.validation}`);
  return { ...receipt, ...target, host };
}

export function consumerPin(source, manifest, armReceipt, host) {
  const receipt = receiptForHost(source, armReceipt, host);
  if (receipt.schema !== 1 || receipt.variant !== manifest.variant ||
      receipt.commit !== source.commit || receipt.commit !== manifest.upstreamCommit ||
      receipt.crateVersion !== source.crateVersion || receipt.zigVersion !== source.zigVersion ||
      receipt.patchSha256 !== manifest.patch.sha256 ||
      (host === "aarch64-macos" && (
        receipt.rustTarget !== "aarch64-apple-darwin" ||
        receipt.producerTarget !== manifest.producerTarget ||
        receipt.minimumMacOS !== manifest.minimumMacOS
      )) ||
      JSON.stringify(receipt.capabilities) !== JSON.stringify(capabilities) ||
      !checksum(receipt.sha256) || !checksum(receipt.manifestSha256) || !checksum(receipt.terminalHeaderSha256)) {
    throw new Error("native core consumer identity mismatch");
  }
  return { ...source, releaseTag: "terax-native-core-v1",
    targets: { [host]: { rustTarget: receipt.rustTarget, sha256: receipt.sha256 } } };
}
export function validatePackage(manifest, receipt, read) {
  const build = JSON.parse(read("build.json").toString("utf8"));
  if (digest(read("share/terax-native-core/manifest.json")) !== receipt.manifestSha256 ||
      digest(read("include/ghostty/vt/terminal.h")) !== receipt.terminalHeaderSha256 ||
      build.terminalHeaderSha256 !== receipt.terminalHeaderSha256 ||
      build.manifestSha256 !== receipt.manifestSha256 ||
      build.upstreamCommit !== manifest.upstreamCommit || build.variant !== manifest.variant ||
      build.patchSha256 !== manifest.patch.sha256 || build.producerTarget !== receipt.producerTarget ||
      build.zigVersion !== manifest.zigVersion || build.target !== receipt.rustTarget ||
      JSON.stringify(build.capabilities) !== JSON.stringify(capabilities)) {
    throw new Error("native core package does not match the reviewed consumer");
  }
  if (receipt.host === "aarch64-macos") {
    const focused = build.nativeTests?.[0];
    if (build.architectures !== "arm64" || build.nativeTestsPassed !== true ||
        !focused || focused.skippedAllowed !== false || focused.passed !== focused.total ||
        focused.passed < manifest.minimumFocusedTests) throw new Error("native core focused evidence is incomplete");
  } else if (!Array.isArray(build.members) || !build.members.length) {
    throw new Error("native core member evidence is incomplete");
  }
  if (!receipt.host.endsWith("-macos")) return;
  if (!Array.isArray(build.deploymentObjects) || !build.deploymentObjects.length ||
      build.deploymentObjects.some((item) => {
        if (!/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(item.minimumMacOS)) return true;
        const [major, minor, patch = 0] = item.minimumMacOS.split(".").map(Number);
        return major > 11 || (major === 11 && (minor > 0 || patch > 0));
      })) {
    throw new Error("native core deployment evidence exceeds macOS 11.0");
  }
}
