/// <reference types="vite/client" />

import type { BuildInfo } from "./lib/buildInfo";

declare global {
  const __TERAX_BUILD_INFO__: BuildInfo;
}
