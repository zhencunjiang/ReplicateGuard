import { contextBridge, ipcRenderer } from "electron";
import type {
  ReplicateGuardDesktopApi,
  SaveReportRequest,
} from "../shared/contracts";
import type {
  CountQcSettings,
  SaveCountQcRequest,
} from "../shared/count-qc-types";
import type { ColumnRoles } from "../shared/core";

const api: ReplicateGuardDesktopApi = {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  openMetadata: () => ipcRenderer.invoke("metadata:open"),
  importMetadataBytes: (name: string, bytes: Uint8Array) =>
    ipcRenderer.invoke("metadata:bytes", name, bytes),
  loadBundledExample: () => ipcRenderer.invoke("metadata:example"),
  loadUrl: (url: string) => ipcRenderer.invoke("metadata:url", url),
  runAudit: (datasetId: string, roles: ColumnRoles) =>
    ipcRenderer.invoke("audit:run", datasetId, roles),
  saveReport: (request: SaveReportRequest) =>
    ipcRenderer.invoke("report:save", request),
  openCountMatrix: () => ipcRenderer.invoke("counts:open"),
  loadBundledCountExample: () => ipcRenderer.invoke("counts:example"),
  runCountQc: (datasetId: string, settings: CountQcSettings) =>
    ipcRenderer.invoke("counts:run", datasetId, settings),
  saveCountQc: (request: SaveCountQcRequest) =>
    ipcRenderer.invoke("counts:save", request),
};

contextBridge.exposeInMainWorld("replicateGuard", api);
