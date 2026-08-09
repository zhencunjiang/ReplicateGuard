import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
} from "electron";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  addKnownDerivedColumns,
  auditMetadata,
  parseDelimited,
  type AuditReport,
  type ColumnRoles,
  type MetadataRow,
} from "../shared/core";
import type {
  DatasetSummary,
  SaveReportRequest,
  SaveReportResult,
} from "../shared/contracts";
import {
  countQcRow,
  inspectCountMatrix,
  runCountQc,
  type CountQcAnalysis,
  type StoredCountMatrix,
} from "../shared/count-qc";
import type {
  CountMatrixSummary,
  CountQcReport,
  CountQcSettings,
  SaveCountQcRequest,
} from "../shared/count-qc-types";

const KANG_FILENAME = "GSE96583_batch2.total.tsne.df.tsv.gz";
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

type StoredDataset = {
  name: string;
  source: string;
  columns: string[];
  rows: MetadataRow[];
};

const datasets = new Map<string, StoredDataset>();
const countMatrices = new Map<string, StoredCountMatrix>();
const countAnalyses = new Map<string, CountQcAnalysis>();

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 940,
    minHeight: 680,
    backgroundColor: "#f3f0e7",
    show: false,
    title: "ReplicateGuard",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return window;
}

function decodeMetadata(
  bytes: Uint8Array,
  name: string,
  contentType = "",
): string {
  const buffer = Buffer.from(bytes);
  const gzipMagic = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const compressed =
    name.toLowerCase().endsWith(".gz") ||
    contentType.includes("gzip") ||
    contentType.includes("x-gzip") ||
    gzipMagic;
  try {
    return (compressed ? gunzipSync(buffer) : buffer).toString("utf8");
  } catch (error) {
    throw new Error(
      `Unable to decompress ${name}: ${error instanceof Error ? error.message : "invalid file format"}`,
    );
  }
}

function storeDataset(
  name: string,
  source: string,
  text: string,
): DatasetSummary {
  const table = addKnownDerivedColumns(parseDelimited(text));
  const id = randomUUID();
  datasets.clear();
  datasets.set(id, {
    name,
    source,
    columns: table.columns,
    rows: table.rows,
  });
  return {
    id,
    name,
    source,
    columns: table.columns,
    rowCount: table.rows.length,
    preview: table.rows.slice(0, 5),
  };
}

async function importPath(filePath: string): Promise<DatasetSummary> {
  const bytes = await readFile(filePath);
  return storeDataset(
    basename(filePath),
    filePath,
    decodeMetadata(bytes, basename(filePath)),
  );
}

function bundledExamplePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "data", KANG_FILENAME);
  }
  return join(app.getAppPath(), "resources", "data", KANG_FILENAME);
}

function bundledCountExamplePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "data", "qc-demo");
  }
  return join(app.getAppPath(), "resources", "data", "qc-demo");
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildHtmlReport(report: AuditReport, sourceName: string): string {
  const findings = report.issues
    .map(
      (finding) => `<article class="issue ${finding.severity.toLowerCase()}">
<div class="meta">${escapeHtml(finding.severity)} · ${escapeHtml(finding.code)}</div>
<h3>${escapeHtml(finding.title)}</h3>
<p>${escapeHtml(finding.message)}</p>
${
  finding.recommendation
    ? `<p class="next"><strong>Recommendation:</strong> ${escapeHtml(finding.recommendation)}</p>`
    : ""
}
</article>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ReplicateGuard report · ${escapeHtml(sourceName)}</title>
<style>
body{margin:0;background:#f3f0e7;color:#172034;font:15px/1.65 Arial,sans-serif}
main{max-width:960px;margin:auto;padding:48px 24px}.hero{background:#18254b;color:white;padding:34px;border-radius:6px 28px}
.status{font-size:52px;font-weight:800;line-height:1.1}.sub{color:#cbd3ef}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}
.metric,.issue{background:white;border:1px solid #dbd9d2;border-radius:10px;padding:18px}.metric b{font-size:28px}
.issue{margin:12px 0}.error{border-left:6px solid #b83232}.warning{border-left:6px solid #d48b18}.info{border-left:6px solid #3569a8}
.meta{color:#697080;font:11px monospace}.next{background:#f3f5fb;padding:10px}.formula{font:14px monospace;background:#e8ebf5;padding:12px;border-radius:6px}
@media(max-width:700px){.grid{grid-template-columns:1fr 1fr}}
</style></head><body><main>
<section class="hero"><small>ReplicateGuard ${escapeHtml(report.software_version)}</small>
<div class="status">${report.status}</div><div class="sub">${escapeHtml(sourceName)} · ${new Date().toISOString()}</div></section>
<section class="grid">
<div class="metric"><b>${report.summary.n_observations}</b><br>Observations</div>
<div class="metric"><b>${report.summary.n_samples}</b><br>Biological samples</div>
<div class="metric"><b>${report.summary.n_conditions}</b><br>Conditions</div>
<div class="metric"><b>${escapeHtml(report.design_rank)}/${report.design_columns.length}</b><br>Design matrix rank</div>
</section>
<h2>Recommended design</h2><div class="formula">~ ${escapeHtml(report.formula_terms.join(" + "))}</div>
<h2>Condition contrasts</h2>
<ul>${report.contrasts
    .map(
      (contrast) =>
        `<li>${escapeHtml(contrast.name)} — ${contrast.estimable ? "Estimable" : "Not estimable"}</li>`,
    )
    .join("")}</ul>
<h2>Design findings</h2>${findings || "<p>No reportable issues were detected.</p>"}
<h2>Recommendations</h2><ol>${report.recommendations
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("")}</ol>
<p><small>ReplicateGuard is licensed for noncommercial academic and research use only.</small></p>
</main></body></html>`;
}

function buildCountQcHtmlReport(report: CountQcReport): string {
  const preview = report.preview
    .map(
      (row) => `<tr><td>${escapeHtml(row.barcode)}</td><td>${row.totalCounts}</td><td>${row.detectedGenes}</td><td>${(row.mitochondrialFraction * 100).toFixed(2)}%</td><td>${row.ambientFdr === null ? "—" : row.ambientFdr.toExponential(2)}</td><td>${row.doubletScore === null ? "—" : row.doubletScore.toFixed(4)}</td><td>${escapeHtml(row.doubletCall)}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ReplicateGuard count-matrix QC · ${escapeHtml(report.sourceName)}</title>
<style>
body{margin:0;background:#f3f0e7;color:#172034;font:15px/1.6 Arial,sans-serif}main{max-width:1050px;margin:auto;padding:46px 24px}
.hero{background:#18254b;color:white;padding:34px;border-radius:6px 28px}.hero h1{font-size:38px;margin:5px 0}.sub{color:#cbd3ef}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.metric,.method{background:white;border:1px solid #dbd9d2;border-radius:10px;padding:18px}.metric b{font-size:28px}
table{border-collapse:collapse;background:white;width:100%;font-size:12px}th,td{border:1px solid #dedbd2;padding:8px;text-align:left}th{background:#ebeef8}.method{margin:12px 0}.warning{background:#fff4dc;border-left:5px solid #ca8218;padding:12px;margin:8px 0}
@media(max-width:700px){.grid{grid-template-columns:1fr 1fr}}
</style></head><body><main>
<section class="hero"><small>ReplicateGuard ${escapeHtml(report.softwareVersion)}</small><h1>Count-matrix QC</h1><div class="sub">${escapeHtml(report.sourceName)} · ${escapeHtml(report.createdAt)}</div></section>
<section class="grid"><div class="metric"><b>${report.summary.nBarcodes}</b><br>Barcodes</div><div class="metric"><b>${report.summary.nCalledCells}</b><br>Called cells</div><div class="metric"><b>${report.summary.nEmptyDroplets}</b><br>Empty droplets</div><div class="metric"><b>${report.summary.nPredictedDoublets}</b><br>Predicted doublets</div></section>
<h2>QC summary</h2><ul><li>Barcode-rank knee: ${report.summary.kneeUmiThreshold} UMI</li><li>Ambient-profile barcodes: ${report.summary.ambientBarcodeCount}</li><li>Median cell library: ${report.summary.medianCellUmis} UMI and ${report.summary.medianGenesPerCell} detected genes</li><li>Predicted doublet rate: ${(report.summary.predictedDoubletRate * 100).toFixed(2)}%</li></ul>
<h2>Methods</h2><div class="method"><strong>Cell calling</strong><p>${escapeHtml(report.methods.cellCalling)}</p></div><div class="method"><strong>Doublet detection</strong><p>${escapeHtml(report.methods.doubletDetection)}</p></div>
${report.warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("")}
<h2>Highest doublet scores</h2><table><thead><tr><th>Barcode</th><th>UMI</th><th>Genes</th><th>Mitochondrial</th><th>Ambient FDR</th><th>Doublet score</th><th>Call</th></tr></thead><tbody>${preview}</tbody></table>
<h2>Limitations</h2><ul>${report.methods.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
<p><small>ReplicateGuard is licensed for noncommercial academic and research use only.</small></p>
</main></body></html>`;
}

async function writeCountQcCsv(path: string, analysis: CountQcAnalysis): Promise<void> {
  const output = createWriteStream(path, { encoding: "utf8" });
  output.write(
    "barcode,total_counts,detected_genes,mitochondrial_fraction,ambient_p_value,ambient_fdr,cell_call,doublet_score,doublet_call\n",
  );
  for (let index = 0; index < analysis.barcodes.length; index += 1) {
    const row = countQcRow(analysis, index);
    const values = [
      row.barcode,
      row.totalCounts,
      row.detectedGenes,
      row.mitochondrialFraction,
      row.ambientPValue ?? "",
      row.ambientFdr ?? "",
      row.cellCall,
      row.doubletScore ?? "",
      row.doubletCall,
    ];
    const line = values
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(",");
    if (!output.write(`${line}\n`)) await once(output, "drain");
  }
  output.end();
  await once(output, "finish");
}

function registerIpcHandlers(): void {
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
  }));

  ipcMain.handle("metadata:open", async (): Promise<DatasetSummary | null> => {
    const result = await dialog.showOpenDialog({
      title: "Select single-cell metadata",
      properties: ["openFile"],
      filters: [
        {
          name: "Metadata",
          extensions: ["csv", "tsv", "txt", "gz"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importPath(result.filePaths[0]);
  });

  ipcMain.handle(
    "metadata:bytes",
    (
      _event,
      name: string,
      bytes: Uint8Array,
    ): DatasetSummary => {
      if (!name || !(bytes instanceof Uint8Array)) {
        throw new Error("The dropped file is invalid.");
      }
      return storeDataset(name, `Dropped file: ${name}`, decodeMetadata(bytes, name));
    },
  );

  ipcMain.handle("metadata:example", () => importPath(bundledExamplePath()));

  ipcMain.handle("counts:open", async (): Promise<CountMatrixSummary | null> => {
    const result = await dialog.showOpenDialog({
      title: "Select a raw 10x Matrix Market directory",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const matrix = await inspectCountMatrix(result.filePaths[0], randomUUID());
    countMatrices.clear();
    countAnalyses.clear();
    countMatrices.set(matrix.id, matrix);
    return matrix;
  });

  ipcMain.handle("counts:example", async (): Promise<CountMatrixSummary> => {
    const matrix = await inspectCountMatrix(bundledCountExamplePath(), randomUUID());
    countMatrices.clear();
    countAnalyses.clear();
    countMatrices.set(matrix.id, matrix);
    return matrix;
  });

  ipcMain.handle(
    "counts:run",
    async (
      _event,
      datasetId: string,
      settings: CountQcSettings,
    ): Promise<CountQcReport> => {
      const matrix = countMatrices.get(datasetId);
      if (!matrix) {
        throw new Error("The count matrix is no longer available. Select the directory again.");
      }
      const analysis = await runCountQc(matrix, settings, randomUUID());
      countAnalyses.clear();
      countAnalyses.set(analysis.report.id, analysis);
      return analysis.report;
    },
  );

  ipcMain.handle(
    "metadata:url",
    async (_event, rawUrl: string): Promise<DatasetSummary> => {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        throw new Error("Enter a valid HTTPS file URL.");
      }
      if (url.protocol !== "https:") {
        throw new Error("Only HTTPS download URLs are allowed.");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const response = await net.fetch(url.toString(), {
          method: "GET",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
        const declaredLength = Number(response.headers.get("content-length") ?? 0);
        if (declaredLength > MAX_DOWNLOAD_BYTES) {
          throw new Error("The file exceeds the 50 MB desktop download limit.");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
          throw new Error("The file exceeds the 50 MB desktop download limit.");
        }
        const name = basename(url.pathname) || "remote-metadata.tsv";
        return storeDataset(
          name,
          url.toString(),
          decodeMetadata(
            bytes,
            name,
            response.headers.get("content-type") ?? "",
          ),
        );
      } finally {
        clearTimeout(timer);
      }
    },
  );

  ipcMain.handle(
    "audit:run",
    (_event, datasetId: string, roles: ColumnRoles): AuditReport => {
      const dataset = datasets.get(datasetId);
      if (!dataset) {
        throw new Error("The dataset is no longer available. Import the file again.");
      }
      return auditMetadata(dataset.rows, roles);
    },
  );

  ipcMain.handle(
    "report:save",
    async (
      _event,
      request: SaveReportRequest,
    ): Promise<SaveReportResult> => {
      const extension = request.format === "json" ? "json" : "html";
      const result = await dialog.showSaveDialog({
        title: "Save ReplicateGuard report",
        defaultPath: `replicateguard-report.${extension}`,
        filters: [
          {
            name: request.format === "json" ? "JSON report" : "HTML report",
            extensions: [extension],
          },
        ],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const content =
        request.format === "json"
          ? JSON.stringify(request.report, null, 2)
          : buildHtmlReport(request.report, request.sourceName);
      await writeFile(result.filePath, content, "utf8");
      return { canceled: false, path: result.filePath };
    },
  );

  ipcMain.handle(
    "counts:save",
    async (
      _event,
      request: SaveCountQcRequest,
    ): Promise<SaveReportResult> => {
      const analysis = countAnalyses.get(request.reportId);
      if (!analysis) {
        throw new Error("The count-matrix QC result is no longer available. Run QC again.");
      }
      const extension = request.format;
      const result = await dialog.showSaveDialog({
        title: "Save ReplicateGuard count-matrix QC",
        defaultPath: `replicateguard-count-qc.${extension}`,
        filters: [
          {
            name: request.format === "csv"
              ? "Barcode QC table"
              : request.format === "json"
                ? "JSON report"
                : "HTML report",
            extensions: [extension],
          },
        ],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      if (request.format === "csv") {
        await writeCountQcCsv(result.filePath, analysis);
      } else {
        const content = request.format === "json"
          ? JSON.stringify(analysis.report, null, 2)
          : buildCountQcHtmlReport(analysis.report);
        await writeFile(result.filePath, content, "utf8");
      }
      return { canceled: false, path: result.filePath };
    },
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerIpcHandlers();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
