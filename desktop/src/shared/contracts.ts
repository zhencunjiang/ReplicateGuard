import type { AuditReport, ColumnRoles, MetadataRow } from "./core";
import type {
  CountMatrixSummary,
  CountQcReport,
  CountQcSettings,
  SaveCountQcRequest,
} from "./count-qc-types";

export type DatasetSummary = {
  id: string;
  name: string;
  source: string;
  columns: string[];
  rowCount: number;
  preview: MetadataRow[];
};

export type SaveReportRequest = {
  format: "html" | "json";
  report: AuditReport;
  sourceName: string;
};

export type SaveReportResult = {
  canceled: boolean;
  path?: string;
};

export type AppInfo = {
  version: string;
  platform: string;
  packaged: boolean;
};

export type ReplicateGuardDesktopApi = {
  getAppInfo: () => Promise<AppInfo>;
  openMetadata: () => Promise<DatasetSummary | null>;
  importMetadataBytes: (
    name: string,
    bytes: Uint8Array,
  ) => Promise<DatasetSummary>;
  loadBundledExample: () => Promise<DatasetSummary>;
  loadUrl: (url: string) => Promise<DatasetSummary>;
  runAudit: (datasetId: string, roles: ColumnRoles) => Promise<AuditReport>;
  saveReport: (request: SaveReportRequest) => Promise<SaveReportResult>;
  openCountMatrix: () => Promise<CountMatrixSummary | null>;
  loadBundledCountExample: () => Promise<CountMatrixSummary>;
  runCountQc: (
    datasetId: string,
    settings: CountQcSettings,
  ) => Promise<CountQcReport>;
  saveCountQc: (request: SaveCountQcRequest) => Promise<SaveReportResult>;
};
