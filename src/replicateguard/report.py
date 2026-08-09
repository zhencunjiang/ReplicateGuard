"""JSON and self-contained HTML reporting."""

import html
import json
from pathlib import Path
from typing import Any, Dict

from .models import AuditReport


def write_json(report: AuditReport, path: str) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(report.to_dict(), indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def _format_value(value: Any) -> str:
    if isinstance(value, dict):
        return ", ".join(f"{key}: {item}" for key, item in value.items())
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    if value is None:
        return "not specified"
    return str(value)


def render_html(report: AuditReport) -> str:
    """Return a standalone, dependency-free audit report."""

    status_class = report.status.lower()
    summary_rows = "".join(
        "<tr><th>{}</th><td>{}</td></tr>".format(
            html.escape(key.replace("_", " ").title()),
            html.escape(_format_value(value)),
        )
        for key, value in report.summary.items()
    )
    issue_cards = []
    for issue in report.issues:
        evidence = ""
        if issue.evidence:
            evidence = "<dl>{}</dl>".format(
                "".join(
                    "<dt>{}</dt><dd>{}</dd>".format(
                        html.escape(str(key).replace("_", " ").title()),
                        html.escape(_format_value(value)),
                    )
                    for key, value in issue.evidence.items()
                )
            )
        recommendation = (
            f"<p><strong>Action:</strong> {html.escape(issue.recommendation)}</p>"
            if issue.recommendation
            else ""
        )
        issue_cards.append(
            f"""
            <article class="issue {issue.severity.lower()}">
              <div class="issue-heading">
                <span class="severity">{html.escape(issue.severity)}</span>
                <code>{html.escape(issue.code)}</code>
              </div>
              <h3>{html.escape(issue.title)}</h3>
              <p>{html.escape(issue.message)}</p>
              {evidence}
              {recommendation}
            </article>
            """
        )
    if not issue_cards:
        issue_cards.append("<p>No design findings were generated.</p>")
    contrast_rows = "".join(
        "<tr><td>{}</td><td>{}</td></tr>".format(
            html.escape(str(contrast["name"])),
            "yes" if contrast["estimable"] else "no",
        )
        for contrast in report.contrasts
    ) or "<tr><td colspan='2'>No condition contrasts available</td></tr>"
    recommendations = "".join(
        f"<li>{html.escape(item)}</li>" for item in report.recommendations
    )
    formula = " + ".join(report.formula_terms) or "not available"
    columns = ", ".join(report.design_columns) or "not available"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ReplicateGuard design audit</title>
<style>
:root {{
  color-scheme: light dark;
  --bg: #f7f8fa; --surface: #ffffff; --text: #17212b; --muted: #59636e;
  --border: #d9dee5; --pass: #16794b; --review: #a25b00; --fail: #b42318;
  --info: #2563a7; --warning: #a25b00; --error: #b42318;
}}
@media (prefers-color-scheme: dark) {{
  :root {{
    --bg: #11161c; --surface: #19212a; --text: #eef3f8; --muted: #b6c0ca;
    --border: #36414d; --pass: #53c98c; --review: #f0ae54; --fail: #ff8177;
    --info: #78b7ef; --warning: #f0ae54; --error: #ff8177;
  }}
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; font: 16px/1.55 system-ui, sans-serif; color: var(--text); background: var(--bg); }}
main {{ max-width: 1080px; margin: 0 auto; padding: 32px 20px 64px; }}
h1, h2, h3 {{ line-height: 1.2; }}
h1 {{ margin-bottom: 6px; }}
h2 {{ margin-top: 36px; }}
.lede {{ color: var(--muted); margin-top: 0; }}
.status {{ display: inline-block; padding: 6px 12px; border: 2px solid currentColor; border-radius: 999px; font-weight: 700; }}
.status.pass {{ color: var(--pass); }} .status.review {{ color: var(--review); }} .status.fail {{ color: var(--fail); }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }}
.panel, .issue {{ background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }}
th {{ width: 48%; }}
.issue {{ border-left: 5px solid var(--border); }}
.issue.info {{ border-left-color: var(--info); }} .issue.warning {{ border-left-color: var(--warning); }} .issue.error {{ border-left-color: var(--error); }}
.issue-heading {{ display: flex; justify-content: space-between; gap: 12px; }}
.severity {{ font-weight: 800; }}
.info .severity {{ color: var(--info); }} .warning .severity {{ color: var(--warning); }} .error .severity {{ color: var(--error); }}
dl {{ display: grid; grid-template-columns: minmax(120px, 1fr) 2fr; gap: 5px 12px; }}
dt {{ color: var(--muted); }} dd {{ margin: 0; overflow-wrap: anywhere; }}
code {{ overflow-wrap: anywhere; }}
footer {{ color: var(--muted); margin-top: 40px; }}
</style>
</head>
<body>
<main>
  <header>
    <h1>ReplicateGuard design audit</h1>
    <p class="lede">Preflight validation for sample-aware single-cell differential expression</p>
    <p class="status {status_class}">{html.escape(report.status)}</p>
  </header>
  <section>
    <h2>Design summary</h2>
    <div class="grid">
      <div class="panel"><table>{summary_rows}</table></div>
      <div class="panel">
        <p><strong>Proposed formula</strong><br><code>~ {html.escape(formula)}</code></p>
        <p><strong>Design columns</strong><br><code>{html.escape(columns)}</code></p>
        <p><strong>Rank</strong>: {html.escape(_format_value(report.design_rank))}</p>
        <p><strong>Residual df</strong>: {html.escape(_format_value(report.residual_degrees_of_freedom))}</p>
      </div>
    </div>
  </section>
  <section>
    <h2>Contrast estimability</h2>
    <div class="panel"><table><thead><tr><th>Contrast</th><th>Estimable</th></tr></thead><tbody>{contrast_rows}</tbody></table></div>
  </section>
  <section>
    <h2>Findings</h2>
    <div class="grid">{''.join(issue_cards)}</div>
  </section>
  <section>
    <h2>Recommended actions</h2>
    <div class="panel"><ol>{recommendations}</ol></div>
  </section>
  <footer>Generated by ReplicateGuard {html.escape(report.software_version)}.</footer>
</main>
</body>
</html>
"""


def write_html(report: AuditReport, path: str) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render_html(report), encoding="utf-8")

