import { spawnSync } from "node:child_process";

const DEFAULT_REPOSITORY = "Sendery/terax-ai";

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function normalizeBranchName(value) {
  const branch = (value ?? "").trim();
  if (!branch) return "unknown";
  if (branch === "HEAD") return "detached";
  return branch
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\/[^/]+\//, "")
    .replace(/^remotes\/[^/]+\//, "")
    .replace(/^origin\//, "");
}

export function createBuildInfo({
  env = process.env,
  version,
  git = runGit,
  now = () => new Date().toISOString(),
}) {
  const explicitBranch = env.TERAX_BUILD_BRANCH?.trim();
  const currentBranch = explicitBranch || git(["branch", "--show-current"]);
  const branch = normalizeBranchName(
    currentBranch || git(["name-rev", "--name-only", "--exclude=tags/*", "HEAD"]),
  );

  return {
    repository: env.TERAX_BUILD_REPOSITORY?.trim() || DEFAULT_REPOSITORY,
    branch,
    commit: env.TERAX_BUILD_COMMIT?.trim() || git(["rev-parse", "HEAD"]) || "unknown",
    builtAt: env.TERAX_BUILD_DATE?.trim() || now(),
    channel: version.includes("-") ? "development" : "official",
  };
}
