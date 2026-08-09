"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  auditMetadata,
  type AuditReport,
  type ColumnRoles,
} from "./lib/audit";
import {
  addKnownDerivedColumns,
  type MetadataRow,
  parseDelimited,
  readMetadataFile,
  readMetadataResponse,
} from "./lib/parse";

const KANG_URL =
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE96nnn/GSE96583/suppl/GSE96583_batch2.total.tsne.df.tsv.gz";

const DEMO_TEXT = `cell_id\tsample_id\tsubject\tcondition\tbatch\tcell_type
c001\tP01__ctrl\tP01\tctrl\tB1\tCD4 T
c002\tP01__ctrl\tP01\tctrl\tB1\tB
c003\tP01__stim\tP01\tstim\tB1\tCD4 T
c004\tP01__stim\tP01\tstim\tB1\tB
c005\tP02__ctrl\tP02\tctrl\tB1\tCD4 T
c006\tP02__ctrl\tP02\tctrl\tB1\tB
c007\tP02__stim\tP02\tstim\tB2\tCD4 T
c008\tP02__stim\tP02\tstim\tB2\tB
c009\tP03__ctrl\tP03\tctrl\tB2\tCD4 T
c010\tP03__ctrl\tP03\tctrl\tB2\tB
c011\tP03__stim\tP03\tstim\tB2\tCD4 T
c012\tP03__stim\tP03\tstim\tB2\tB`;

type RoleKey =
  | "barcode"
  | "sample"
  | "condition"
  | "subject"
  | "batch"
  | "cellType"
  | "doublet"
  | "qcStatus";

const ROLE_LABELS: Array<{
  key: RoleKey;
  title: string;
  detail: string;
  required?: boolean;
}> = [
  { key: "barcode", title: "Cell barcode", detail: "Optional barcode for joining cell-QC calls" },
  {
    key: "sample",
    title: "Biological sample",
    detail: "Independent sampling unit; not a cell barcode",
    required: true,
  },
  {
    key: "condition",
    title: "Condition",
    detail: "Control, treated, disease, or another study group",
    required: true,
  },
  { key: "subject", title: "Subject", detail: "Patient, donor, or animal ID" },
  { key: "batch", title: "Batch", detail: "Library, sequencing, or experimental batch" },
  { key: "cellType", title: "Cell type", detail: "Cell type or cluster annotation" },
  { key: "doublet", title: "Doublet call", detail: "Optional singlet/doublet or multiplet label" },
  { key: "qcStatus", title: "Cell QC status", detail: "Optional pass/fail or cell/empty label" },
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

function formatPairing(value: AuditReport["summary"]["pairing"]): string {
  const labels = {
    complete: "Complete",
    partial: "Partial",
    unpaired: "Unpaired",
    not_specified: "Not specified",
  };
  return labels[value];
}

function saveDownload(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function htmlReport(report: AuditReport, sourceName: string): string {
  const escaped = (value: unknown) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const issues = report.issues
    .map(
      (finding) => `<article class="issue ${finding.severity.toLowerCase()}">
  <div><b>${escaped(finding.severity)}</b> · ${escaped(finding.code)}</div>
  <h3>${escaped(finding.title)}</h3>
  <p>${escaped(finding.message)}</p>
  ${finding.recommendation ? `<p><strong>Recommendation:</strong> ${escaped(finding.recommendation)}</p>` : ""}
</article>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ReplicateGuard report · ${escaped(sourceName)}</title>
<style>
body{font:15px/1.6 Arial,sans-serif;color:#17212b;background:#f5f2ea;margin:0}
main{max-width:920px;margin:auto;padding:48px 24px}.head{background:#18254b;color:white;padding:32px;border-radius:20px}
.status{font-size:42px;font-weight:800}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}
.metric,.issue{background:white;padding:18px;border:1px solid #dfe2e5;border-radius:12px}.issue{margin:12px 0}
.error{border-left:6px solid #b83232}.warning{border-left:6px solid #d48b18}.info{border-left:6px solid #3466a8}
code{background:#eceef2;padding:3px 6px;border-radius:4px}@media(max-width:680px){.grid{grid-template-columns:1fr 1fr}}
</style></head><body><main>
<section class="head"><small>ReplicateGuard 0.1.0</small><div class="status">${report.status}</div>
<div>${escaped(sourceName)} · generated ${new Date().toISOString()}</div></section>
<section class="grid">
<div class="metric"><b>${report.summary.n_observations}</b><br>Observations</div>
<div class="metric"><b>${report.summary.n_samples}</b><br>Biological samples</div>
<div class="metric"><b>${report.summary.n_conditions}</b><br>Conditions</div>
<div class="metric"><b>${escaped(report.design_rank)}/${report.design_columns.length}</b><br>Design matrix rank</div>
</section>
<h2>Recommended model</h2><p><code>~ ${escaped(report.formula_terms.join(" + "))}</code></p>
<h2>Design findings</h2>${issues || "<p>No reportable issues were detected.</p>"}
<h2>Recommendations</h2><ol>${report.recommendations.map((item) => `<li>${escaped(item)}</li>`).join("")}</ol>
</main></body></html>`;
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<MetadataRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [roles, setRoles] = useState<ColumnRoles>({
    sample: "",
    condition: "",
    analysisUnit: "auto",
    minReplicates: 2,
  });
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState(KANG_URL);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const previewRows = rows.slice(0, 5);
  const maxSampleCount = useMemo(
    () =>
      report
        ? Math.max(1, ...Object.values(report.summary.samples_per_condition))
        : 1,
    [report],
  );

  function ingest(text: string, name: string) {
    const table = addKnownDerivedColumns(parseDelimited(text));
    setRows(table.rows);
    setColumns(table.columns);
    setRoles(inferRoles(table.columns));
    setSourceName(name);
    setReport(null);
    setError("");
  }

  async function loadFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      ingest(await readMetadataFile(file), file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The file could not be parsed.");
    } finally {
      setBusy(false);
    }
  }

  async function loadUrl(url = sourceUrl) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url);
      const name = new URL(url).pathname.split("/").pop() || "remote-metadata.tsv";
      ingest(await readMetadataResponse(response, name), name);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `${caught.message}. If the data host blocks cross-origin downloads, download the file first and then drop it onto this page.`
          : "The download or parsing operation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function runAudit() {
    setError("");
    try {
      const result = auditMetadata(rows, roles);
      setReport(result);
      requestAnimationFrame(() =>
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The design audit failed.");
    }
  }

  function updateRole(key: RoleKey, value: string) {
    setRoles((current) => ({
      ...current,
      [key]: value || undefined,
    }));
    setReport(null);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void loadFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files?.[0]);
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="ReplicateGuard home">
          <span className="brand-mark">RG</span>
          <span>ReplicateGuard</span>
        </a>
        <nav aria-label="Page navigation">
          <a href="#workspace">Start analysis</a>
          <a href="#method">Audit scope</a>
          <span className="version">v0.1.0</span>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow">
            SINGLE-CELL DESIGN PREFLIGHT <span>·</span> BROWSER EDITION
          </div>
          <h1>
            Do not mistake cell counts
            <br />
            for biological replication.
          </h1>
          <p className="hero-lede">
            Drop in single-cell metadata. ReplicateGuard checks biological
            replication, pairing, batch confounding, and contrast estimability
            before differential expression.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#workspace">
              Audit my data <span aria-hidden="true">↓</span>
            </a>
            <button className="button text-button" onClick={() => ingest(DEMO_TEXT, "paired-demo.tsv")}>
              View a small example
            </button>
          </div>
          <div className="privacy-note">
            <span className="privacy-dot" />
            Files are processed only in your browser and are never uploaded
          </div>
        </div>
        <div className="hero-visual" aria-label="Analysis workflow overview">
          <div className="specimen-tag">DESIGN / 001</div>
          <div className="cell-field">
            {Array.from({ length: 28 }, (_, index) => (
              <span
                className={`cell cell-${(index % 5) + 1}`}
                key={index}
                style={
                  {
                    "--x": `${8 + ((index * 29) % 84)}%`,
                    "--y": `${9 + ((index * 47) % 80)}%`,
                    "--delay": `${(index % 7) * -0.4}s`,
                  } as React.CSSProperties
                }
              />
            ))}
            <div className="sample-ring ring-one">P01</div>
            <div className="sample-ring ring-two">P02</div>
            <div className="sample-ring ring-three">P03</div>
          </div>
          <div className="visual-caption">
            <span>29,065 cells</span>
            <span className="arrow">→</span>
            <strong>16 biological samples</strong>
          </div>
        </div>
      </section>

      <section className="workspace-shell" id="workspace">
        <div className="section-heading">
          <div>
            <span className="step-label">01 · INPUT</span>
            <h2>Add your metadata</h2>
          </div>
          <p>
            Provide <strong>metadata</strong>, not an expression matrix or FASTQ
            files. CSV, TSV, TXT, and gzip-compressed tables are supported.
          </p>
        </div>

        <div className="input-grid">
          <div
            className={`dropzone ${dragging ? "dragging" : ""} ${rows.length ? "loaded" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,.gz,text/csv,text/tab-separated-values"
              onChange={onFileChange}
              hidden
            />
            <div className="drop-icon" aria-hidden="true">
              {rows.length ? "✓" : "⇧"}
            </div>
            {rows.length ? (
              <>
                <span className="loaded-label">DATASET READY</span>
                <h3>{sourceName}</h3>
                <p>
                  {rows.length.toLocaleString()} rows · {columns.length} columns
                </p>
                <button className="button secondary" onClick={() => fileInput.current?.click()}>
                  Choose another file
                </button>
              </>
            ) : (
              <>
                <h3>{busy ? "Reading…" : "Drop a metadata file here"}</h3>
                <p>or choose a CSV, TSV, or TSV.GZ file from your computer</p>
                <button className="button secondary" onClick={() => fileInput.current?.click()}>
                  Choose file
                </button>
              </>
            )}
          </div>

          <div className="remote-card">
            <div className="card-kicker">PUBLIC DATA</div>
            <h3>Kang18 · GSE96583</h3>
            <p>
              Control and IFN-β-stimulated PBMCs from eight donors, suitable
              for validating paired designs and cell-level metadata handling.
            </p>
            <button
              className="button dark"
              disabled={busy}
              onClick={() => void loadUrl(KANG_URL)}
            >
              {busy ? "Downloading…" : "Load 29,065 cells from NCBI"}
            </button>
            <details>
              <summary>Use another public URL</summary>
              <label htmlFor="source-url">HTTPS file URL</label>
              <div className="url-row">
                <input
                  id="source-url"
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://…/metadata.tsv.gz"
                />
                <button
                  className="mini-button"
                  disabled={busy || !sourceUrl}
                  onClick={() => void loadUrl()}
                >
                  Load
                </button>
              </div>
            </details>
          </div>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <strong>Unable to continue</strong>
            <span>{error}</span>
          </div>
        )}
      </section>

      {rows.length > 0 && (
        <section className="mapping-section">
          <div className="section-heading">
            <div>
              <span className="step-label">02 · MAP</span>
              <h2>Define each metadata column</h2>
            </div>
            <p>Common column names were inferred automatically. Verify the biological-sample definition before running the audit.</p>
          </div>

          <div className="mapping-layout">
            <div className="role-grid">
              {ROLE_LABELS.map((role) => (
                <label className="role-card" key={role.key}>
                  <span>
                    {role.title}
                    {role.required && <em>Required</em>}
                  </span>
                  <small>{role.detail}</small>
                  <select
                    value={(roles[role.key] as string | undefined) ?? ""}
                    onChange={(event) => updateRole(role.key, event.target.value)}
                  >
                    <option value="">{role.required ? "Select a column…" : "Not provided"}</option>
                    {columns.map((column) => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <aside className="settings-card">
              <div className="card-kicker">INFERENCE SETTINGS</div>
              <label>
                Analysis unit
                <select
                  value={roles.analysisUnit}
                  onChange={(event) =>
                    setRoles((current) => ({
                      ...current,
                      analysisUnit: event.target.value as ColumnRoles["analysisUnit"],
                    }))
                  }
                >
                  <option value="auto">Auto-detect (recommended)</option>
                  <option value="sample">Sample level</option>
                  <option value="cell">Cell level (check pseudoreplication)</option>
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
                      minReplicates: Math.max(1, Number(event.target.value) || 1),
                    }))
                  }
                />
              </label>
              <button
                className="button primary run-button"
                disabled={!roles.sample || !roles.condition}
                onClick={runAudit}
              >
                Run design audit <span aria-hidden="true">→</span>
              </button>
            </aside>
          </div>

          <div className="preview-table-wrap">
            <div className="preview-head">
              <strong>Data preview</strong>
              <span>First 5 of {rows.length.toLocaleString()} rows</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {columns.slice(0, 8).map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={index}>
                      {columns.slice(0, 8).map((column) => (
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

      {report && (
        <section className={`results-section status-${report.status.toLowerCase()}`} id="results">
          <div className="result-hero">
            <div>
              <span className="step-label light">03 · RESULT</span>
              <div className="status-lockup">
                <span className="status-orb">{report.status === "PASS" ? "✓" : report.status === "REVIEW" ? "!" : "×"}</span>
                <div>
                  <span className="status-overline">DESIGN STATUS</span>
                  <h2>{report.status}</h2>
                </div>
              </div>
              <p>
                {report.status === "PASS"
                  ? "No design issue blocks the target contrast."
                  : report.status === "REVIEW"
                    ? "The analysis may proceed, but the warnings require explanation or sensitivity analysis."
                    : "The current design contains an issue that invalidates inference or makes a contrast non-estimable."}
              </p>
            </div>
            <div className="download-actions">
              <button
                className="button light-button"
                onClick={() =>
                  saveDownload(
                    htmlReport(report, sourceName),
                    "replicateguard-report.html",
                    "text/html",
                  )
                }
              >
                Download HTML report
              </button>
              <button
                className="button outline-light"
                onClick={() =>
                  saveDownload(
                    JSON.stringify(report, null, 2),
                    "replicateguard-report.json",
                    "application/json",
                  )
                }
              >
                JSON
              </button>
            </div>
          </div>

          <div className="metrics-grid">
            <div className="metric-card">
              <span>OBSERVATIONS</span>
              <strong>{report.summary.n_observations.toLocaleString()}</strong>
              <small>{report.summary.cell_level_input ? "cell-level input" : "sample-level input"}</small>
            </div>
            <div className="metric-card accent">
              <span>BIOLOGICAL SAMPLES</span>
              <strong>{report.summary.n_samples}</strong>
              <small>independent units of replication</small>
            </div>
            <div className="metric-card">
              <span>PAIRING</span>
              <strong className="metric-text">{formatPairing(report.summary.pairing)}</strong>
              <small>{report.summary.n_subjects ?? "—"} subjects</small>
            </div>
            <div className="metric-card">
              <span>DESIGN RANK</span>
              <strong>
                {report.design_rank}/{report.design_columns.length}
              </strong>
              <small>{report.residual_degrees_of_freedom} residual df</small>
            </div>
          </div>

          <div className="results-grid">
            <div className="findings-panel">
              <div className="panel-heading">
                <div>
                  <span className="card-kicker">FINDINGS</span>
                  <h3>Design audit results</h3>
                </div>
                <span className="finding-count">{report.issues.length}</span>
              </div>
              <div className="finding-list">
                {report.issues.length === 0 && (
                  <div className="empty-result">No reportable issues were detected.</div>
                )}
                {report.issues.map((finding) => (
                  <article className={`finding severity-${finding.severity.toLowerCase()}`} key={`${finding.code}-${finding.title}`}>
                    <div className="severity-mark">{finding.severity === "ERROR" ? "×" : finding.severity === "WARNING" ? "!" : "i"}</div>
                    <div>
                      <div className="finding-meta">
                        <span>{finding.severity}</span>
                        <code>{finding.code}</code>
                      </div>
                      <h4>{finding.title}</h4>
                      <p>{finding.message}</p>
                      {finding.recommendation && (
                        <div className="recommendation">
                          <strong>Next step</strong> {finding.recommendation}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <aside className="design-panel">
              <div className="card-kicker">MODEL PLAN</div>
              <h3>Recommended design</h3>
              <div className="formula">~ {report.formula_terms.join(" + ")}</div>
              <div className="condition-bars">
                <strong>Independent samples per condition</strong>
                {Object.entries(report.summary.samples_per_condition).map(
                  ([condition, count]) => (
                    <div className="condition-row" key={condition}>
                      <span>{condition}</span>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{ width: `${(count / maxSampleCount) * 100}%` }}
                        />
                      </div>
                      <b>{count}</b>
                    </div>
                  ),
                )}
              </div>
              <div className="contrast-block">
                <strong>Condition contrasts</strong>
                {report.contrasts.length ? (
                  report.contrasts.map((contrast) => (
                    <div className="contrast-row" key={contrast.name}>
                      <span>{contrast.name}</span>
                      <b className={contrast.estimable ? "estimable" : "not-estimable"}>
                        {contrast.estimable ? "Estimable" : "Not estimable"}
                      </b>
                    </div>
                  ))
                ) : (
                  <p>At least two conditions are required.</p>
                )}
              </div>
            </aside>
          </div>
        </section>
      )}

      <section className="method-section" id="method">
        <div className="section-heading">
          <div>
            <span className="step-label">METHOD</span>
            <h2>What does it check?</h2>
          </div>
          <p>The goal is not to perform differential expression, but to verify that the design supports the comparison before the model runs.</p>
        </div>
        <div className="method-grid">
          {[
            ["01", "Replication unit", "Distinguishes cell counts from independent biological samples and detects pseudoreplication."],
            ["02", "Pairing and batch", "Detects complete or partial pairing, condition-batch association, and single-sample batches."],
            ["03", "Design matrix", "Builds the design matrix and checks rank, residual degrees of freedom, and redundant terms."],
            ["04", "Contrasts", "Determines whether the target condition coefficient lies in the estimable space of the design matrix."],
          ].map(([number, title, body]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <div className="brand">
          <span className="brand-mark">RG</span>
          <span>ReplicateGuard</span>
        </div>
        <p>
          Use the browser edition for interactive preflight checks. Save the JSON report or use the Python CLI for reproducible formal analyses.
        </p>
        <span>Noncommercial academic research use only</span>
      </footer>
    </main>
  );
}
