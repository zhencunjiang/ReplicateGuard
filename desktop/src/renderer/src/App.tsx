import {
  type DragEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AuditReport,
  ColumnRoles,
} from "../../shared/core";
import type {
  AppInfo,
  DatasetSummary,
} from "../../shared/contracts";
import type {
  CountMatrixSummary,
  CountQcReport,
  CountQcSettings,
} from "../../shared/count-qc-types";

const KANG_URL =
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE96nnn/GSE96583/suppl/GSE96583_batch2.total.tsne.df.tsv.gz";

type RoleKey =
  | "barcode"
  | "sample"
  | "condition"
  | "subject"
  | "batch"
  | "cellType"
  | "doublet"
  | "qcStatus";

const ROLE_DEFINITIONS: Array<{
  key: RoleKey;
  label: string;
  help: string;
  required?: boolean;
}> = [
  {
    key: "barcode",
    label: "Cell barcode",
    help: "Optional barcode used to join count-matrix QC calls",
  },
  {
    key: "sample",
    label: "Biological sample",
    help: "Independent sampling unit, not a cell barcode",
    required: true,
  },
  {
    key: "condition",
    label: "Condition",
    help: "Treatment, disease status, or study group",
    required: true,
  },
  { key: "subject", label: "Subject", help: "Patient, donor, or animal ID" },
  { key: "batch", label: "Batch", help: "Library, sequencing, or experimental batch" },
  { key: "cellType", label: "Cell type", help: "Cell type or cluster annotation" },
  {
    key: "doublet",
    label: "Doublet call",
    help: "Optional singlet/doublet or singlet/multiplet label",
  },
  {
    key: "qcStatus",
    label: "Cell QC status",
    help: "Optional pass/fail, cell/empty, or retained/discarded label",
  },
];

const CANDIDATES: Record<RoleKey, string[]> = {
  barcode: ["barcode", "cell_barcode", "row_id", "cell_id"],
  sample: ["sample_id", "sample", "orig.ident", "sampleid", "library"],
  condition: ["condition", "stim", "treatment", "group", "status"],
  subject: ["subject", "ind", "donor", "patient", "individual"],
  batch: ["batch", "batch_id", "lane", "plate"],
  cellType: ["cell_type", "celltype", "cell", "cluster", "cell_type_annot"],
  doublet: ["doublet_call", "doublet_class", "multiplets", "doublet", "multiplet"],
  qcStatus: ["qc_status", "cell_call", "filter_status", "pass_qc"],
};

function inferRoles(columns: string[]): ColumnRoles {
  const lower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  const find = (role: RoleKey) =>
    CANDIDATES[role].map((candidate) => lower.get(candidate)).find(Boolean) ?? "";
  return {
    barcode: find("barcode") || undefined,
    sample: find("sample"),
    condition: find("condition"),
    subject: find("subject") || undefined,
    batch: find("batch") || undefined,
    cellType: find("cellType") || undefined,
    doublet: find("doublet") || undefined,
    qcStatus: find("qcStatus") || undefined,
    analysisUnit: "auto",
    minReplicates: 2,
  };
}

function pairingLabel(value: AuditReport["summary"]["pairing"]): string {
  return {
    complete: "Complete",
    partial: "Partial",
    unpaired: "Unpaired",
    not_specified: "Not specified",
  }[value];
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, "")
    .replace(/^Error:\s*/i, "");
}

export default function App() {
  const [mode, setMode] = useState<"counts" | "design">("counts");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [roles, setRoles] = useState<ColumnRoles>({
    sample: "",
    condition: "",
    analysisUnit: "auto",
    minReplicates: 2,
  });
  const [report, setReport] = useState<AuditReport | null>(null);
  const [countMatrix, setCountMatrix] = useState<CountMatrixSummary | null>(null);
  const [countReport, setCountReport] = useState<CountQcReport | null>(null);
  const [countSettings, setCountSettings] = useState<CountQcSettings>({
    expectedCells: 0,
    ambientMaxUmis: 100,
    minimumCandidateUmis: 50,
    cellCallingFdr: 0.01,
    expectedDoubletRate: 0.06,
  });
  const [url, setUrl] = useState(KANG_URL);
  const [busy, setBusy] = useState("");
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  useEffect(() => {
    void window.replicateGuard.getAppInfo().then(setAppInfo);
  }, []);

  const maxSampleCount = useMemo(
    () =>
      report
        ? Math.max(1, ...Object.values(report.summary.samples_per_condition))
        : 1,
    [report],
  );

  function acceptDataset(next: DatasetSummary | null) {
    if (!next) return;
    setDataset(next);
    setRoles(inferRoles(next.columns));
    setReport(null);
    setMessage(null);
  }

  function acceptCountMatrix(next: CountMatrixSummary | null) {
    if (!next) return;
    setCountMatrix(next);
    setCountReport(null);
    setMessage(null);
  }

  async function runTask(label: string, task: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      setMessage({ kind: "error", text: cleanError(error) });
    } finally {
      setBusy("");
    }
  }

  function openFile() {
    void runTask("Reading file…", async () => {
      acceptDataset(await window.replicateGuard.openMetadata());
    });
  }

  function openCountMatrix() {
    void runTask("Inspecting the 10x count matrix…", async () => {
      acceptCountMatrix(await window.replicateGuard.openCountMatrix());
    });
  }

  function loadCountExample() {
    void runTask("Loading the bundled count-matrix demo…", async () => {
      acceptCountMatrix(await window.replicateGuard.loadBundledCountExample());
      setCountSettings((current) => ({
        ...current,
        expectedCells: 200,
        expectedDoubletRate: 0.2,
      }));
    });
  }

  function loadExample() {
    void runTask("Loading bundled data…", async () => {
      acceptDataset(await window.replicateGuard.loadBundledExample());
    });
  }

  function loadUrl() {
    void runTask("Downloading and decompressing…", async () => {
      acceptDataset(await window.replicateGuard.loadUrl(url));
    });
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    await runTask("Importing dropped file…", async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      acceptDataset(
        await window.replicateGuard.importMetadataBytes(file.name, bytes),
      );
    });
  }

  function updateRole(key: RoleKey, value: string) {
    setRoles((current) => ({
      ...current,
      [key]: value || undefined,
    }));
    setReport(null);
  }

  function runAudit() {
    if (!dataset) return;
    void runTask("Auditing the experimental design…", async () => {
      const next = await window.replicateGuard.runAudit(dataset.id, roles);
      setReport(next);
      requestAnimationFrame(() => {
        document
          .getElementById("results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function saveReport(format: "html" | "json") {
    if (!report || !dataset) return;
    void runTask(`Saving ${format.toUpperCase()}…`, async () => {
      const result = await window.replicateGuard.saveReport({
        format,
        report,
        sourceName: dataset.name,
      });
      if (!result.canceled) {
        setMessage({
          kind: "success",
          text: `Report saved: ${result.path}`,
        });
      }
    });
  }

  function runCountMatrixQc() {
    if (!countMatrix) return;
    void runTask("Calling cells and screening synthetic doublets…", async () => {
      const next = await window.replicateGuard.runCountQc(
        countMatrix.id,
        countSettings,
      );
      setCountReport(next);
      requestAnimationFrame(() => {
        document
          .getElementById("count-results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function saveCountQc(format: "html" | "json" | "csv") {
    if (!countReport) return;
    void runTask(`Saving ${format.toUpperCase()}…`, async () => {
      const result = await window.replicateGuard.saveCountQc({
        reportId: countReport.id,
        format,
      });
      if (!result.canceled) {
        setMessage({ kind: "success", text: `Report saved: ${result.path}` });
      }
    });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">RG</span>
          <div>
            <strong>ReplicateGuard</strong>
            <small>LOCAL QC + DESIGN PREFLIGHT</small>
          </div>
        </div>
        <div className="local-state">
          <span className="state-dot" />
          Local mode
          <span className="version">
            v{appInfo?.version ?? "0.1.0"} ·{" "}
            {appInfo?.platform ?? "desktop"}
          </span>
        </div>
      </header>

      <main>
        <nav className="workflow-tabs" aria-label="Analysis workflows">
          <button
            className={mode === "counts" ? "active" : ""}
            onClick={() => setMode("counts")}
          >
            <span>01</span>
            Count-matrix QC
            <small>Empty droplets + doublets</small>
          </button>
          <button
            className={mode === "design" ? "active" : ""}
            onClick={() => setMode("design")}
          >
            <span>02</span>
            Differential-expression QC
            <small>Replication + model design</small>
          </button>
        </nav>

        <section className="intro">
          <div className="intro-copy">
            <span className="eyebrow">
              {mode === "counts"
                ? "DROPLET-BASED SINGLE-CELL QUALITY CONTROL"
                : "SAMPLE-AWARE DIFFERENTIAL-EXPRESSION QC"}
            </span>
            <h1>
              {mode === "counts"
                ? "Separate signal from empty droplets and multiplets."
                : "Prove the design before differential expression."}
            </h1>
            <p>
              {mode === "counts"
                ? "Import a raw 10x Matrix Market directory to estimate the ambient RNA profile, call cell-containing droplets, and screen synthetic doublets before downstream analysis."
                : "Import cell- or sample-level metadata to audit biological replication, cell-count balance, retained QC failures, pairing, batch confounding, design-matrix rank, and condition-contrast estimability."}
            </p>
          </div>
          <div className="privacy-card">
            <span className="privacy-icon">⌂</span>
            <div>
              <strong>Your data stays on this computer</strong>
              <p>
                Count-matrix processing, design auditing, and report generation
                are performed by the local desktop backend.
              </p>
            </div>
          </div>
        </section>

        {mode === "counts" && (
          <>
            <section className="workspace-card count-import-card">
              <div className="section-title">
                <span>01</span>
                <div>
                  <small>IMPORT RAW COUNTS</small>
                  <h2>Select a 10x Matrix Market directory</h2>
                </div>
              </div>

              <div className="count-source-grid">
                <article className={`matrix-picker ${countMatrix ? "has-data" : ""}`}>
                  <div className="drop-symbol">{countMatrix ? "✓" : "▦"}</div>
                  {countMatrix ? (
                    <>
                      <span className="ready-label">COUNT MATRIX READY</span>
                      <h3>{countMatrix.name}</h3>
                      <p>
                        {countMatrix.nBarcodes.toLocaleString()} barcodes ·{" "}
                        {countMatrix.nFeatures.toLocaleString()} features ·{" "}
                        {countMatrix.nNonZero.toLocaleString()} nonzero entries
                      </p>
                      <code>{countMatrix.directory}</code>
                      <button className="button secondary" onClick={openCountMatrix}>
                        Choose another directory
                      </button>
                    </>
                  ) : (
                    <>
                      <h3>Raw 10x Matrix Market data</h3>
                      <p>
                        Select a folder containing matrix.mtx[.gz],
                        barcodes.tsv[.gz], and features.tsv[.gz]. Use the raw,
                        not filtered, barcode matrix for empty-droplet testing.
                      </p>
                      <button className="button primary" onClick={openCountMatrix}>
                        Choose count-matrix directory
                      </button>
                    </>
                  )}
                </article>

                <article className="source-option built-in count-demo">
                  <span className="option-tag">OFFLINE QC DEMO</span>
                  <h3>Synthetic droplets</h3>
                  <p>
                    A deterministic 500-barcode dataset containing 300 ambient
                    droplets, 160 singlets, and 40 synthetic doublets validates
                    the complete local pipeline.
                  </p>
                  <button className="button dark" onClick={loadCountExample}>
                    Load bundled QC demo
                  </button>
                </article>
              </div>

              {busy && (
                <div className="busy-line" role="status"><span />{busy}</div>
              )}
              {message && (
                <div className={`message ${message.kind}`} role="alert">
                  <strong>{message.kind === "error" ? "Unable to continue" : "Complete"}</strong>
                  <span>{message.text}</span>
                </div>
              )}
            </section>

            {countMatrix && (
              <section className="workspace-card count-settings-card">
                <div className="section-title">
                  <span>02</span>
                  <div>
                    <small>CONFIGURE CELL CALLING</small>
                    <h2>Confirm QC assumptions</h2>
                  </div>
                </div>
                <div className="count-settings-grid">
                  <label>
                    <span>Expected recovered cells</span>
                    <small>Use 0 for automatic barcode-rank knee detection</small>
                    <input
                      type="number"
                      min={0}
                      value={countSettings.expectedCells}
                      onChange={(event) => setCountSettings((current) => ({
                        ...current,
                        expectedCells: Math.max(0, Number(event.target.value) || 0),
                      }))}
                    />
                  </label>
                  <label>
                    <span>Ambient-profile maximum UMI</span>
                    <small>Low-count barcodes used to estimate ambient RNA</small>
                    <input
                      type="number"
                      min={1}
                      value={countSettings.ambientMaxUmis}
                      onChange={(event) => setCountSettings((current) => ({
                        ...current,
                        ambientMaxUmis: Math.max(1, Number(event.target.value) || 1),
                      }))}
                    />
                  </label>
                  <label>
                    <span>Minimum candidate UMI</span>
                    <small>Lower barcodes are classified as empty without testing</small>
                    <input
                      type="number"
                      min={1}
                      value={countSettings.minimumCandidateUmis}
                      onChange={(event) => setCountSettings((current) => ({
                        ...current,
                        minimumCandidateUmis: Math.max(1, Number(event.target.value) || 1),
                      }))}
                    />
                  </label>
                  <label>
                    <span>Cell-calling FDR</span>
                    <small>Benjamini-Hochberg threshold for ambient testing</small>
                    <input
                      type="number"
                      min={0.001}
                      max={0.25}
                      step={0.001}
                      value={countSettings.cellCallingFdr}
                      onChange={(event) => setCountSettings((current) => ({
                        ...current,
                        cellCallingFdr: Number(event.target.value) || 0.01,
                      }))}
                    />
                  </label>
                  <label>
                    <span>Expected doublet rate</span>
                    <small>Fraction of called cells expected to be multiplets</small>
                    <input
                      type="number"
                      min={0}
                      max={0.3}
                      step={0.01}
                      value={countSettings.expectedDoubletRate}
                      onChange={(event) => setCountSettings((current) => ({
                        ...current,
                        expectedDoubletRate: Number(event.target.value) || 0,
                      }))}
                    />
                  </label>
                  <button
                    className="button primary count-run"
                    onClick={runCountMatrixQc}
                    disabled={Boolean(busy)}
                  >
                    Run droplet and doublet QC <span>→</span>
                  </button>
                </div>
              </section>
            )}

            {countReport && (
              <section className="result-card count-result" id="count-results">
                <div className="result-header">
                  <div className="result-status">
                    <span>✓</span>
                    <div>
                      <small>COUNT-MATRIX QC COMPLETE</small>
                      <h2>QC</h2>
                      <p>
                        Cell-containing droplets were separated from the ambient
                        profile and called cells were screened against synthetic
                        doublets. Review warnings before filtering barcodes.
                      </p>
                    </div>
                  </div>
                  <div className="report-buttons count-report-buttons">
                    <button onClick={() => saveCountQc("html")}>Save HTML</button>
                    <button onClick={() => saveCountQc("json")}>Save JSON</button>
                    <button onClick={() => saveCountQc("csv")}>Save barcode CSV</button>
                  </div>
                </div>
                <div className="metric-grid">
                  <article><small>BARCODES</small><strong>{countReport.summary.nBarcodes.toLocaleString()}</strong><span>{countReport.summary.nNonzeroBarcodes.toLocaleString()} nonzero</span></article>
                  <article className="highlight"><small>CALLED CELLS</small><strong>{countReport.summary.nCalledCells.toLocaleString()}</strong><span>knee at {countReport.summary.kneeUmiThreshold.toLocaleString()} UMI</span></article>
                  <article><small>EMPTY / AMBIGUOUS</small><strong>{countReport.summary.nEmptyDroplets.toLocaleString()}</strong><span>{countReport.summary.nAmbiguousDroplets.toLocaleString()} ambiguous</span></article>
                  <article><small>PREDICTED DOUBLETS</small><strong>{countReport.summary.nPredictedDoublets.toLocaleString()}</strong><span>{(countReport.summary.predictedDoubletRate * 100).toFixed(2)}% of called cells</span></article>
                </div>
                <div className="count-result-body">
                  <div className="qc-chart-panel">
                    <div className="result-section-head"><div><small>DISTRIBUTIONS</small><h3>QC score profiles</h3></div></div>
                    <div className="mini-chart-block">
                      <strong>Barcode UMI distribution · log10 scale</strong>
                      <div className="mini-histogram">
                        {countReport.umiHistogram.map((bin, index) => (
                          <i key={index} title={`${bin.lower.toFixed(2)}–${bin.upper.toFixed(2)}: ${bin.count}`} style={{ height: `${Math.max(3, (bin.count / Math.max(1, ...countReport.umiHistogram.map((item) => item.count))) * 100)}%` }} />
                        ))}
                      </div>
                    </div>
                    <div className="mini-chart-block">
                      <strong>Doublet-score distribution</strong>
                      <div className="mini-histogram doublet-histogram">
                        {countReport.doubletHistogram.map((bin, index) => (
                          <i key={index} title={`${bin.lower.toFixed(2)}–${bin.upper.toFixed(2)}: ${bin.count}`} style={{ height: `${Math.max(3, (bin.count / Math.max(1, ...countReport.doubletHistogram.map((item) => item.count))) * 100)}%` }} />
                        ))}
                      </div>
                    </div>
                    {countReport.warnings.map((warning) => <div className="qc-warning" key={warning}>! {warning}</div>)}
                  </div>
                  <aside className="model-panel qc-method-panel">
                    <small>METHODS</small>
                    <h3>Transparent local calls</h3>
                    <strong>Cell calling</strong><p>{countReport.methods.cellCalling}</p>
                    <strong>Doublet screening</strong><p>{countReport.methods.doubletDetection}</p>
                  </aside>
                </div>
                <div className="qc-preview-table data-preview">
                  <div className="preview-head"><strong>Highest doublet scores</strong><span>Top {countReport.preview.length} called barcodes</span></div>
                  <div className="table-scroll"><table><thead><tr><th>Barcode</th><th>UMI</th><th>Genes</th><th>Mitochondrial</th><th>Ambient FDR</th><th>Doublet score</th><th>Call</th></tr></thead><tbody>
                    {countReport.preview.map((row) => <tr key={row.barcode}><td>{row.barcode}</td><td>{row.totalCounts}</td><td>{row.detectedGenes}</td><td>{(row.mitochondrialFraction * 100).toFixed(2)}%</td><td>{row.ambientFdr === null ? "—" : row.ambientFdr.toExponential(2)}</td><td>{row.doubletScore === null ? "—" : row.doubletScore.toFixed(4)}</td><td><b className={row.doubletCall === "doublet" ? "call-doublet" : "call-singlet"}>{row.doubletCall}</b></td></tr>)}
                  </tbody></table></div>
                </div>
              </section>
            )}
          </>
        )}

        <section className="workspace-card" hidden={mode !== "design"}>
          <div className="section-title">
            <span>01</span>
            <div>
              <small>IMPORT METADATA</small>
              <h2>Select a data source</h2>
            </div>
          </div>

          <div className="source-grid">
            <div
              className={`drop-zone ${dragging ? "dragging" : ""} ${
                dataset ? "has-data" : ""
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => void handleDrop(event)}
            >
              <div className="drop-symbol">{dataset ? "✓" : "⇧"}</div>
              {dataset ? (
                <>
                  <span className="ready-label">DATASET READY</span>
                  <h3>{dataset.name}</h3>
                  <p>
                    {dataset.rowCount.toLocaleString()} rows ·{" "}
                    {dataset.columns.length} columns
                  </p>
                  <button className="button secondary" onClick={openFile}>
                    Choose another local file
                  </button>
                </>
              ) : (
                <>
                  <h3>Drop a CSV, TSV, or TSV.GZ file</h3>
                  <p>Supports Seurat meta.data, AnnData obs, and sample-level design tables</p>
                  <button className="button primary" onClick={openFile}>
                    Choose local file
                  </button>
                </>
              )}
            </div>

            <div className="source-options">
              <article className="source-option built-in">
                <span className="option-tag">OFFLINE EXAMPLE</span>
                <h3>Kang18 · GSE96583</h3>
                <p>
                  The installer includes public metadata for 29,065 cells, so
                  you can validate a complete paired design offline.
                </p>
                <button className="button dark" onClick={loadExample}>
                  Load bundled test data
                </button>
              </article>

              <article className="source-option url-option">
                <span className="option-tag">HTTPS DOWNLOAD</span>
                <label htmlFor="metadata-url">Public data file URL</label>
                <div className="url-input">
                  <input
                    id="metadata-url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://…/metadata.tsv.gz"
                  />
                  <button onClick={loadUrl} disabled={!url || Boolean(busy)}>
                    Download
                  </button>
                </div>
              </article>
            </div>
          </div>

          {busy && (
            <div className="busy-line" role="status">
              <span />
              {busy}
            </div>
          )}
          {message && (
            <div className={`message ${message.kind}`} role="alert">
              <strong>{message.kind === "error" ? "Unable to continue" : "Complete"}</strong>
              <span>{message.text}</span>
            </div>
          )}
        </section>

        {mode === "design" && dataset && (
          <section className="workspace-card mapping-card">
            <div className="section-title">
              <span>02</span>
              <div>
                <small>DEFINE THE DESIGN</small>
                <h2>Confirm metadata roles</h2>
              </div>
            </div>

            <div className="mapping-layout">
              <div className="role-list">
                {ROLE_DEFINITIONS.map((definition) => (
                  <label className="role-row" key={definition.key}>
                    <div>
                      <strong>
                        {definition.label}
                        {definition.required && <em>Required</em>}
                      </strong>
                      <small>{definition.help}</small>
                    </div>
                    <select
                      value={
                        (roles[definition.key] as string | undefined) ?? ""
                      }
                      onChange={(event) =>
                        updateRole(definition.key, event.target.value)
                      }
                    >
                      <option value="">
                        {definition.required ? "Select a column…" : "Not provided"}
                      </option>
                      {dataset.columns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <aside className="settings-panel">
                <span className="option-tag">INFERENCE SETTINGS</span>
                <label>
                  Analysis unit
                  <select
                    value={roles.analysisUnit}
                    onChange={(event) =>
                      setRoles((current) => ({
                        ...current,
                        analysisUnit: event.target
                          .value as ColumnRoles["analysisUnit"],
                      }))
                    }
                  >
                    <option value="auto">Auto-detect (recommended)</option>
                    <option value="sample">Sample level</option>
                    <option value="cell">Cell level</option>
                  </select>
                </label>
                <label>
                  Minimum independent samples per condition
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={roles.minReplicates}
                    onChange={(event) =>
                      setRoles((current) => ({
                        ...current,
                        minReplicates: Math.max(
                          1,
                          Number(event.target.value) || 1,
                        ),
                      }))
                    }
                  />
                </label>
                <button
                  className="button primary run"
                  disabled={
                    !roles.sample || !roles.condition || Boolean(busy)
                  }
                  onClick={runAudit}
                >
                  Run design audit <span>→</span>
                </button>
              </aside>
            </div>

            <div className="data-preview">
              <div className="preview-head">
                <strong>Data preview</strong>
                <span>
                  First {dataset.preview.length} of{" "}
                  {dataset.rowCount.toLocaleString()} rows
                </span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {dataset.columns.slice(0, 9).map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataset.preview.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {dataset.columns.slice(0, 9).map((column) => (
                          <td key={column}>{row[column] || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {mode === "design" && report && (
          <section
            className={`result-card result-${report.status.toLowerCase()}`}
            id="results"
          >
            <div className="result-header">
              <div className="result-status">
                <span>
                  {report.status === "PASS"
                    ? "✓"
                    : report.status === "REVIEW"
                      ? "!"
                      : "×"}
                </span>
                <div>
                  <small>DESIGN STATUS</small>
                  <h2>{report.status}</h2>
                  <p>
                    {report.status === "PASS"
                      ? "No design issue blocks the target comparison."
                      : report.status === "REVIEW"
                        ? "The analysis may proceed, but the warnings require explanation and sensitivity analysis."
                        : "The current design contains an issue that invalidates inference or makes a contrast non-estimable."}
                  </p>
                </div>
              </div>
              <div className="report-buttons">
                <button onClick={() => saveReport("html")}>
                  Save HTML report
                </button>
                <button onClick={() => saveReport("json")}>Save JSON</button>
              </div>
            </div>

            <div className="metric-grid">
              <article>
                <small>OBSERVATIONS</small>
                <strong>{report.summary.n_observations.toLocaleString()}</strong>
                <span>
                  {report.summary.cell_level_input
                    ? "cell-level input"
                    : "sample-level input"}
                </span>
              </article>
              <article className="highlight">
                <small>BIOLOGICAL SAMPLES</small>
                <strong>{report.summary.n_samples}</strong>
                <span>independent units of replication</span>
              </article>
              <article>
                <small>PAIRING</small>
                <strong className="text-value">
                  {pairingLabel(report.summary.pairing)}
                </strong>
                <span>{report.summary.n_subjects ?? "—"} subjects</span>
              </article>
              <article>
                <small>DESIGN RANK</small>
                <strong>
                  {report.design_rank}/{report.design_columns.length}
                </strong>
                <span>
                  {report.residual_degrees_of_freedom} residual df
                </span>
              </article>
            </div>

            <div className="result-body">
              <div className="findings">
                <div className="result-section-head">
                  <div>
                    <small>FINDINGS</small>
                    <h3>Design audit results</h3>
                  </div>
                  <b>{report.issues.length}</b>
                </div>
                {report.issues.length === 0 && (
                  <p className="empty">No reportable issues were detected.</p>
                )}
                {report.issues.map((finding) => (
                  <article
                    className={`finding finding-${finding.severity.toLowerCase()}`}
                    key={`${finding.code}-${finding.title}`}
                  >
                    <span className="finding-mark">
                      {finding.severity === "ERROR"
                        ? "×"
                        : finding.severity === "WARNING"
                          ? "!"
                          : "i"}
                    </span>
                    <div>
                      <div className="finding-meta">
                        {finding.severity} · {finding.code}
                      </div>
                      <h4>{finding.title}</h4>
                      <p>{finding.message}</p>
                      {finding.recommendation && (
                        <div className="next-step">
                          <strong>Next step</strong>
                          {finding.recommendation}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>

              <aside className="model-panel">
                <small>MODEL PLAN</small>
                <h3>Recommended design</h3>
                <code>~ {report.formula_terms.join(" + ")}</code>

                <div className="condition-summary">
                  <strong>Independent samples per condition</strong>
                  {Object.entries(report.summary.samples_per_condition).map(
                    ([condition, count]) => (
                      <div className="condition-row" key={condition}>
                        <span>{condition}</span>
                        <div>
                          <i
                            style={{
                              width: `${(count / maxSampleCount) * 100}%`,
                            }}
                          />
                        </div>
                        <b>{count}</b>
                      </div>
                    ),
                  )}
                </div>

                <div className="contrast-summary">
                  <strong>Condition contrasts</strong>
                  {report.contrasts.map((contrast) => (
                    <div key={contrast.name}>
                      <span>{contrast.name}</span>
                      <b
                        className={
                          contrast.estimable ? "estimable" : "non-estimable"
                        }
                      >
                        {contrast.estimable ? "Estimable" : "Not estimable"}
                      </b>
                    </div>
                  ))}
                  {!report.contrasts.length && <p>At least two conditions are required.</p>}
                </div>
              </aside>
            </div>
          </section>
        )}
      </main>

      <footer>
        <span>ReplicateGuard Desktop</span>
        <p>Local count-matrix QC and differential-expression preflight · no registration</p>
        <span>Noncommercial academic research use only · v{appInfo?.version ?? "0.1.0"}</span>
      </footer>
    </div>
  );
}
