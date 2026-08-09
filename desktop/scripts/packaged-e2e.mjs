import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [playwrightModule, executablePath] = process.argv.slice(2);
if (!playwrightModule || !executablePath) {
  throw new Error(
    "Usage: node scripts/packaged-e2e.mjs <playwright-index.mjs> <packaged-executable>",
  );
}

const { _electron: electron } = await import(pathToFileURL(playwrightModule).href);
const application = await electron.launch({ executablePath });
const page = await application.firstWindow();
const rendererErrors = [];
page.on("pageerror", (error) => rendererErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") rendererErrors.push(message.text());
});

try {
  await page.getByText("ReplicateGuard", { exact: true }).first().waitFor();
  assert.match(await page.locator("body").innerText(), /Local mode/);
  assert.doesNotMatch(await page.locator("body").innerText(), /[\u3400-\u9fff]/);

  await page.getByRole("button", { name: "Load bundled QC demo" }).click();
  await page.getByText("COUNT MATRIX READY").waitFor();
  assert.match(await page.locator(".matrix-picker").innerText(), /500 barcodes/);
  assert.equal(
    await page
      .locator("label")
      .filter({ hasText: "Expected recovered cells" })
      .locator("input")
      .inputValue(),
    "200",
  );
  assert.equal(
    await page
      .locator("label")
      .filter({ hasText: "Expected doublet rate" })
      .locator("input")
      .inputValue(),
    "0.2",
  );

  await page.getByRole("button", { name: /Run droplet and doublet QC/ }).click();
  await page.locator("#count-results").waitFor();
  const countMetrics = await page.locator("#count-results .metric-grid").innerText();
  assert.match(countMetrics, /BARCODES\s+500/);
  assert.match(countMetrics, /CALLED CELLS\s+200/);
  assert.match(countMetrics, /EMPTY \/ AMBIGUOUS\s+300\s+0 ambiguous/);
  assert.match(countMetrics, /PREDICTED DOUBLETS\s+40\s+20\.00%/);
  assert.equal(await page.locator("#count-results tbody tr").count(), 20);
  assert.equal(
    await page.locator("#count-results tbody .call-doublet").count(),
    20,
  );

  const doubletInput = page
    .locator("label")
    .filter({ hasText: "Expected doublet rate" })
    .locator("input");
  await doubletInput.fill("0.31");
  await page.getByRole("button", { name: /Run droplet and doublet QC/ }).click();
  const alert = page.getByRole("alert");
  await alert.waitFor();
  assert.match(await alert.innerText(), /Expected doublet rate must be between 0 and 0\.30/);

  await page.getByRole("button", { name: /Differential-expression QC/ }).click();
  await page.getByRole("button", { name: "Load bundled test data" }).click();
  await page.getByText("DATASET READY").waitFor();
  assert.match(await page.locator(".drop-zone").innerText(), /29,065 rows/);
  await page.getByRole("button", { name: /Run design audit/ }).click();
  await page.locator("#results").waitFor();
  const designResult = await page.locator("#results").innerText();
  assert.match(designResult, /DESIGN STATUS\s+REVIEW/);
  assert.match(designResult, /OBSERVATIONS\s+29,065/);
  assert.match(designResult, /BIOLOGICAL SAMPLES\s+16/);
  assert.match(designResult, /PAIRING\s+Complete\s+8 subjects/);
  assert.match(designResult, /DESIGN RANK\s+9\/9/);
  assert.match(designResult, /DOUBLET_CALLS_PRESENT/);
  assert.match(designResult, /stim vs ctrl/);

  assert.deepEqual(rendererErrors, []);
  process.stdout.write(
    JSON.stringify(
      {
        packagedApplication: "PASS",
        countWorkflow: {
          barcodes: 500,
          calledCells: 200,
          emptyDroplets: 300,
          predictedDoublets: 40,
        },
        invalidSettingsMessage: "PASS",
        designWorkflow: {
          observations: 29_065,
          biologicalSamples: 16,
          subjects: 8,
          status: "REVIEW",
        },
        rendererErrors,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await application.close();
}
