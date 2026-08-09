import type { ReplicateGuardDesktopApi } from "../../shared/contracts";

declare global {
  interface Window {
    replicateGuard: ReplicateGuardDesktopApi;
  }
}

export {};
