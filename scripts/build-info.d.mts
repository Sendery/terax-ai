export interface BuildInfo {
  repository: string;
  branch: string;
  commit: string;
  builtAt: string;
  channel: "development" | "official";
}

export interface CreateBuildInfoOptions {
  env?: NodeJS.ProcessEnv;
  version: string;
  git?: (args: string[]) => string;
  now?: () => string;
}

export function normalizeBranchName(value?: string): string;
export function createBuildInfo(options: CreateBuildInfoOptions): BuildInfo;
