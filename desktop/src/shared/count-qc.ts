import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { gunzipSync } from "node:zlib";
import { createGunzip } from "node:zlib";
import type {
  CountMatrixSummary,
  CountQcPreviewRow,
  CountQcReport,
  CountQcSettings,
  HistogramBin,
} from "./count-qc-types";

type MatrixPaths = {
  directory: string;
  matrixPath: string;
  barcodesPath: string;
  featuresPath: string;
};

type MatrixDimensions = {
  nFeatures: number;
  nBarcodes: number;
  nNonZero: number;
};

export type StoredCountMatrix = CountMatrixSummary & MatrixPaths;

export type CountQcAnalysis = {
  report: CountQcReport;
  barcodes: string[];
  totalCounts: Uint32Array;
  detectedGenes: Uint32Array;
  mitochondrialCounts: Uint32Array;
  ambientPValues: Float64Array;
  ambientFdr: Float64Array;
  cellCalls: Uint8Array;
  doubletScores: Float64Array;
  doubletCalls: Uint8Array;
};

const DEFAULT_SETTINGS: CountQcSettings = {
  expectedCells: 0,
  ambientMaxUmis: 100,
  minimumCandidateUmis: 50,
  cellCallingFdr: 0.01,
  expectedDoubletRate: 0.06,
};

const HASH_BINS = 48;
const PROJECTION_DIMENSIONS = 18;

function textStream(path: string) {
  const input = createReadStream(path);
  return path.toLowerCase().endsWith(".gz")
    ? input.pipe(createGunzip())
    : input;
}

async function readText(path: string): Promise<string> {
  const bytes = await readFile(path);
  return path.toLowerCase().endsWith(".gz")
    ? gunzipSync(bytes).toString("utf8")
    : bytes.toString("utf8");
}

async function readNonemptyLines(path: string): Promise<string[]> {
  return (await readText(path))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findNamedFile(names: string[], patterns: RegExp[]): string | undefined {
  return names.find((name) => patterns.some((pattern) => pattern.test(name)));
}

async function locateMatrixFiles(directory: string, depth = 0): Promise<MatrixPaths> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const matrix = findNamedFile(files, [/^matrix\.mtx$/i, /^matrix\.mtx\.gz$/i]);
  const barcodes = findNamedFile(files, [/^barcodes\.tsv$/i, /^barcodes\.tsv\.gz$/i]);
  const features = findNamedFile(files, [
    /^features\.tsv$/i,
    /^features\.tsv\.gz$/i,
    /^genes\.tsv$/i,
    /^genes\.tsv\.gz$/i,
  ]);
  if (matrix && barcodes && features) {
    return {
      directory,
      matrixPath: join(directory, matrix),
      barcodesPath: join(directory, barcodes),
      featuresPath: join(directory, features),
    };
  }
  if (depth < 2) {
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try {
        return await locateMatrixFiles(join(directory, entry.name), depth + 1);
      } catch {
        // Continue searching sibling directories.
      }
    }
  }
  throw new Error(
    "No 10x Matrix Market dataset was found. Select a directory containing matrix.mtx[.gz], barcodes.tsv[.gz], and features.tsv[.gz].",
  );
}

async function readMatrixDimensions(path: string): Promise<MatrixDimensions> {
  const lines = createInterface({ input: textStream(path), crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("%")) continue;
    const values = line.split(/\s+/).map(Number);
    if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
      throw new Error("The Matrix Market dimensions line is invalid.");
    }
    lines.close();
    return {
      nFeatures: values[0],
      nBarcodes: values[1],
      nNonZero: values[2],
    };
  }
  throw new Error("The Matrix Market file does not contain dimensions.");
}

async function forEachMatrixEntry(
  path: string,
  callback: (featureIndex: number, barcodeIndex: number, count: number) => void,
): Promise<MatrixDimensions> {
  const lines = createInterface({ input: textStream(path), crlfDelay: Infinity });
  let dimensions: MatrixDimensions | null = null;
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("%")) continue;
    const values = line.split(/\s+/).map(Number);
    if (!dimensions) {
      if (values.length !== 3) throw new Error("Invalid Matrix Market dimensions line.");
      dimensions = {
        nFeatures: values[0],
        nBarcodes: values[1],
        nNonZero: values[2],
      };
      continue;
    }
    if (values.length < 3) throw new Error("Invalid Matrix Market count entry.");
    const featureIndex = values[0] - 1;
    const barcodeIndex = values[1] - 1;
    const count = Math.round(values[2]);
    if (
      featureIndex < 0 ||
      barcodeIndex < 0 ||
      featureIndex >= dimensions.nFeatures ||
      barcodeIndex >= dimensions.nBarcodes ||
      !Number.isFinite(count) ||
      count < 0
    ) {
      throw new Error("The Matrix Market file contains an out-of-range entry.");
    }
    if (count) callback(featureIndex, barcodeIndex, count);
  }
  if (!dimensions) throw new Error("The Matrix Market file contains no dimensions.");
  return dimensions;
}

export async function inspectCountMatrix(
  selectedDirectory: string,
  id: string,
): Promise<StoredCountMatrix> {
  const paths = await locateMatrixFiles(selectedDirectory);
  const [dimensions, barcodes, features] = await Promise.all([
    readMatrixDimensions(paths.matrixPath),
    readNonemptyLines(paths.barcodesPath),
    readNonemptyLines(paths.featuresPath),
  ]);
  if (barcodes.length !== dimensions.nBarcodes) {
    throw new Error(
      `Barcode count mismatch: the matrix has ${dimensions.nBarcodes}, but the barcode file has ${barcodes.length}.`,
    );
  }
  if (features.length !== dimensions.nFeatures) {
    throw new Error(
      `Feature count mismatch: the matrix has ${dimensions.nFeatures}, but the feature file has ${features.length}.`,
    );
  }
  return {
    id,
    name: basename(paths.directory),
    matrixFile: basename(paths.matrixPath),
    barcodesFile: basename(paths.barcodesPath),
    featuresFile: basename(paths.featuresPath),
    ...dimensions,
    ...paths,
  };
}

function featureName(line: string): string {
  const fields = line.split("\t");
  return fields[1] || fields[0] || "";
}

function hashInteger(value: number, seed: number): number {
  let result = Math.imul(value ^ seed, 0x45d9f3b);
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  return (result ^ (result >>> 16)) >>> 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values: number[], center = median(values)): number {
  return median(values.map((value) => Math.abs(value - center))) || 1;
}

function findKneeThreshold(totals: Uint32Array, expectedCells: number): number {
  const sorted = Array.from(totals)
    .filter((value) => value > 0)
    .sort((left, right) => right - left);
  if (!sorted.length) return 0;
  if (expectedCells > 0) {
    return sorted[Math.min(sorted.length - 1, expectedCells - 1)];
  }
  if (sorted.length < 20) return Math.max(1, sorted[sorted.length - 1]);
  const window = Math.max(3, Math.min(80, Math.floor(sorted.length / 250)));
  const upper = Math.max(window + 1, Math.min(sorted.length - window - 1, Math.floor(sorted.length * 0.65)));
  let bestIndex = window;
  let bestDrop = -Infinity;
  for (let index = window; index <= upper; index += 1) {
    const before = Math.log1p(sorted[index - window]);
    const after = Math.log1p(sorted[index + window]);
    const drop = before - after;
    if (drop > bestDrop) {
      bestDrop = drop;
      bestIndex = index;
    }
  }
  return Math.max(1, sorted[bestIndex]);
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019571e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  let x = 0.9999999999998099;
  const adjusted = value - 1;
  coefficients.forEach((coefficient, index) => {
    x += coefficient / (adjusted + index + 1);
  });
  const t = adjusted + coefficients.length - 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (adjusted + 0.5) * Math.log(t) -
    t +
    Math.log(x)
  );
}

function regularizedGammaQ(shape: number, value: number): number {
  if (value <= 0) return 1;
  if (shape <= 0) return 0;
  const epsilon = 1e-12;
  if (value < shape + 1) {
    let sum = 1 / shape;
    let term = sum;
    let current = shape;
    for (let iteration = 1; iteration <= 200; iteration += 1) {
      current += 1;
      term *= value / current;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * epsilon) break;
    }
    const p = sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape));
    return Math.max(0, Math.min(1, 1 - p));
  }
  let b = value + 1 - shape;
  let c = 1 / Number.MIN_VALUE;
  let d = 1 / b;
  let h = d;
  for (let iteration = 1; iteration <= 200; iteration += 1) {
    const an = -iteration * (iteration - shape);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < Number.MIN_VALUE) d = Number.MIN_VALUE;
    c = b + an / c;
    if (Math.abs(c) < Number.MIN_VALUE) c = Number.MIN_VALUE;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return Math.max(
    0,
    Math.min(1, Math.exp(-value + shape * Math.log(value) - logGamma(shape)) * h),
  );
}

function benjaminiHochberg(values: Array<{ index: number; p: number }>): Map<number, number> {
  const sorted = [...values].sort((left, right) => left.p - right.p);
  const result = new Map<number, number>();
  let previous = 1;
  for (let rank = sorted.length; rank >= 1; rank -= 1) {
    const entry = sorted[rank - 1];
    previous = Math.min(previous, (entry.p * sorted.length) / rank);
    result.set(entry.index, Math.max(0, Math.min(1, previous)));
  }
  return result;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function squaredDistance(left: number[], right: number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += (left[index] - right[index]) ** 2;
  }
  return total;
}

function kMeans(vectors: number[][], requestedK: number, seed: number): number[][] {
  if (!vectors.length) return [];
  const k = Math.max(1, Math.min(requestedK, vectors.length));
  const rng = createRng(seed);
  const centroids: number[][] = [];
  const used = new Set<number>();
  while (centroids.length < k) {
    const index = Math.floor(rng() * vectors.length);
    if (used.has(index)) continue;
    used.add(index);
    centroids.push([...vectors[index]]);
  }
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const sums = centroids.map(() => Array(vectors[0].length).fill(0) as number[]);
    const counts = Array(k).fill(0) as number[];
    vectors.forEach((vector) => {
      let best = 0;
      let bestDistance = Infinity;
      centroids.forEach((centroid, index) => {
        const distance = squaredDistance(vector, centroid);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      counts[best] += 1;
      vector.forEach((value, dimension) => {
        sums[best][dimension] += value;
      });
    });
    centroids.forEach((centroid, index) => {
      if (!counts[index]) return;
      centroid.forEach((_, dimension) => {
        centroid[dimension] = sums[index][dimension] / counts[index];
      });
    });
  }
  return centroids;
}

function minimumDistance(vector: number[], centroids: number[][]): number {
  return Math.sqrt(
    Math.min(...centroids.map((centroid) => squaredDistance(vector, centroid))),
  );
}

function histogram(values: number[], bins: number, minimum?: number, maximum?: number): HistogramBin[] {
  if (!values.length) return [];
  const low = minimum ?? values.reduce((current, value) => Math.min(current, value), Infinity);
  const high = maximum ?? values.reduce((current, value) => Math.max(current, value), -Infinity);
  const width = high > low ? (high - low) / bins : 1;
  const counts = Array(bins).fill(0) as number[];
  values.forEach((value) => {
    const index = Math.max(0, Math.min(bins - 1, Math.floor((value - low) / width)));
    counts[index] += 1;
  });
  return counts.map((count, index) => ({
    lower: low + index * width,
    upper: low + (index + 1) * width,
    count,
  }));
}

function validateSettings(settings: CountQcSettings): CountQcSettings {
  const result = { ...DEFAULT_SETTINGS, ...settings };
  if (!Number.isInteger(result.expectedCells) || result.expectedCells < 0) {
    throw new Error("Expected cells must be zero (automatic) or a positive integer.");
  }
  if (!Number.isInteger(result.ambientMaxUmis) || result.ambientMaxUmis < 1) {
    throw new Error("Ambient maximum UMI must be a positive integer.");
  }
  if (!Number.isInteger(result.minimumCandidateUmis) || result.minimumCandidateUmis < 1) {
    throw new Error("Minimum candidate UMI must be a positive integer.");
  }
  if (!(result.cellCallingFdr > 0 && result.cellCallingFdr <= 0.25)) {
    throw new Error("Cell-calling FDR must be greater than zero and no more than 0.25.");
  }
  if (!(result.expectedDoubletRate >= 0 && result.expectedDoubletRate <= 0.3)) {
    throw new Error("Expected doublet rate must be between 0 and 0.30.");
  }
  return result;
}

function previewRow(analysis: CountQcAnalysis, index: number): CountQcPreviewRow {
  const total = analysis.totalCounts[index];
  return {
    barcode: analysis.barcodes[index],
    totalCounts: total,
    detectedGenes: analysis.detectedGenes[index],
    mitochondrialFraction: total ? analysis.mitochondrialCounts[index] / total : 0,
    ambientPValue: Number.isNaN(analysis.ambientPValues[index])
      ? null
      : analysis.ambientPValues[index],
    ambientFdr: Number.isNaN(analysis.ambientFdr[index])
      ? null
      : analysis.ambientFdr[index],
    cellCall: analysis.cellCalls[index] === 2
      ? "cell"
      : analysis.cellCalls[index] === 1
        ? "ambiguous"
        : "empty",
    doubletScore: Number.isNaN(analysis.doubletScores[index])
      ? null
      : analysis.doubletScores[index],
    doubletCall: analysis.doubletCalls[index] === 2
      ? "doublet"
      : analysis.doubletCalls[index] === 1
        ? "singlet"
        : "not_tested",
  };
}

export async function runCountQc(
  matrix: StoredCountMatrix,
  requestedSettings: CountQcSettings,
  reportId: string,
): Promise<CountQcAnalysis> {
  const settings = validateSettings(requestedSettings);
  const [barcodeLines, featureLines] = await Promise.all([
    readNonemptyLines(matrix.barcodesPath),
    readNonemptyLines(matrix.featuresPath),
  ]);
  const barcodes = barcodeLines.map((line) => line.split("\t")[0]);
  const mitochondrial = new Uint8Array(featureLines.length);
  featureLines.forEach((line, index) => {
    if (/^mt-/i.test(featureName(line))) mitochondrial[index] = 1;
  });

  const totalCounts = new Uint32Array(barcodes.length);
  const detectedGenes = new Uint32Array(barcodes.length);
  const mitochondrialCounts = new Uint32Array(barcodes.length);
  const dimensions = await forEachMatrixEntry(
    matrix.matrixPath,
    (featureIndex, barcodeIndex, count) => {
      totalCounts[barcodeIndex] += count;
      detectedGenes[barcodeIndex] += 1;
      if (mitochondrial[featureIndex]) mitochondrialCounts[barcodeIndex] += count;
    },
  );
  if (
    dimensions.nBarcodes !== barcodes.length ||
    dimensions.nFeatures !== featureLines.length
  ) {
    throw new Error("The matrix dimensions changed after the dataset was selected.");
  }

  const kneeUmiThreshold = findKneeThreshold(totalCounts, settings.expectedCells);
  const candidateIndices = Array.from(totalCounts)
    .map((total, index) => ({ total, index }))
    .filter((entry) => entry.total >= settings.minimumCandidateUmis)
    .map((entry) => entry.index);
  if (!candidateIndices.length) {
    throw new Error("No barcode reaches the configured minimum candidate UMI threshold.");
  }
  const candidateLookup = new Int32Array(barcodes.length);
  candidateLookup.fill(-1);
  candidateIndices.forEach((barcodeIndex, candidateIndex) => {
    candidateLookup[barcodeIndex] = candidateIndex;
  });
  const ambientBins = new Float64Array(HASH_BINS);
  const candidateBins = new Uint32Array(candidateIndices.length * HASH_BINS);
  const projections = new Float64Array(candidateIndices.length * PROJECTION_DIMENSIONS);
  await forEachMatrixEntry(matrix.matrixPath, (featureIndex, barcodeIndex, count) => {
    const bin = hashInteger(featureIndex, 17) % HASH_BINS;
    if (totalCounts[barcodeIndex] > 0 && totalCounts[barcodeIndex] <= settings.ambientMaxUmis) {
      ambientBins[bin] += count;
    }
    const candidateIndex = candidateLookup[barcodeIndex];
    if (candidateIndex < 0) return;
    candidateBins[candidateIndex * HASH_BINS + bin] += count;
    if (mitochondrial[featureIndex]) return;
    const projection = hashInteger(featureIndex, 73) % PROJECTION_DIMENSIONS;
    const sign = hashInteger(featureIndex, 191) % 2 ? 1 : -1;
    projections[candidateIndex * PROJECTION_DIMENSIONS + projection] +=
      sign * Math.log1p((count * 10_000) / totalCounts[barcodeIndex]);
  });

  const ambientTotal = ambientBins.reduce((sum, value) => sum + value, 0);
  const ambientBarcodeCount = Array.from(totalCounts).filter(
    (value) => value > 0 && value <= settings.ambientMaxUmis,
  ).length;
  if (!ambientTotal || ambientBarcodeCount < 10) {
    throw new Error(
      "Too few low-count barcodes are available to estimate the ambient RNA profile. Use a raw, not filtered, 10x matrix or increase the ambient UMI limit.",
    );
  }
  const ambientProbabilities = Array.from(ambientBins, (value) =>
    (value + 0.5) / (ambientTotal + 0.5 * HASH_BINS),
  );
  const ambientPValues = new Float64Array(barcodes.length);
  const ambientFdr = new Float64Array(barcodes.length);
  ambientPValues.fill(Number.NaN);
  ambientFdr.fill(Number.NaN);
  const tested: Array<{ index: number; p: number }> = [];
  candidateIndices.forEach((barcodeIndex, candidateIndex) => {
    if (totalCounts[barcodeIndex] >= kneeUmiThreshold) {
      ambientPValues[barcodeIndex] = 0;
      ambientFdr[barcodeIndex] = 0;
      return;
    }
    const total = totalCounts[barcodeIndex];
    let deviance = 0;
    for (let bin = 0; bin < HASH_BINS; bin += 1) {
      const observed = candidateBins[candidateIndex * HASH_BINS + bin];
      if (!observed) continue;
      const expected = Math.max(Number.MIN_VALUE, total * ambientProbabilities[bin]);
      deviance += 2 * observed * Math.log(observed / expected);
    }
    const p = regularizedGammaQ((HASH_BINS - 1) / 2, deviance / 2);
    ambientPValues[barcodeIndex] = p;
    tested.push({ index: barcodeIndex, p });
  });
  benjaminiHochberg(tested).forEach((value, index) => {
    ambientFdr[index] = value;
  });

  const cellCalls = new Uint8Array(barcodes.length);
  candidateIndices.forEach((barcodeIndex) => {
    const hardRetain = totalCounts[barcodeIndex] >= kneeUmiThreshold;
    const fdr = ambientFdr[barcodeIndex];
    if (hardRetain || (!Number.isNaN(fdr) && fdr <= settings.cellCallingFdr)) {
      cellCalls[barcodeIndex] = 2;
    } else if (!Number.isNaN(fdr) && fdr <= Math.min(0.25, settings.cellCallingFdr * 10)) {
      cellCalls[barcodeIndex] = 1;
    }
  });

  const calledBarcodeIndices = Array.from(cellCalls)
    .map((call, index) => ({ call, index }))
    .filter((entry) => entry.call === 2)
    .map((entry) => entry.index);
  const doubletScores = new Float64Array(barcodes.length);
  const doubletCalls = new Uint8Array(barcodes.length);
  doubletScores.fill(Number.NaN);

  if (calledBarcodeIndices.length >= 20 && settings.expectedDoubletRate > 0) {
    const rawVectors = calledBarcodeIndices.map((barcodeIndex) => {
      const candidateIndex = candidateLookup[barcodeIndex];
      const values = Array(PROJECTION_DIMENSIONS + 3).fill(0) as number[];
      for (let dimension = 0; dimension < PROJECTION_DIMENSIONS; dimension += 1) {
        values[dimension] = projections[
          candidateIndex * PROJECTION_DIMENSIONS + dimension
        ];
      }
      values[PROJECTION_DIMENSIONS] = Math.log1p(totalCounts[barcodeIndex]);
      values[PROJECTION_DIMENSIONS + 1] = Math.log1p(detectedGenes[barcodeIndex]);
      values[PROJECTION_DIMENSIONS + 2] = totalCounts[barcodeIndex]
        ? mitochondrialCounts[barcodeIndex] / totalCounts[barcodeIndex]
        : 0;
      return values;
    });
    const means = rawVectors[0].map((_, dimension) =>
      rawVectors.reduce((sum, vector) => sum + vector[dimension], 0) / rawVectors.length,
    );
    const deviations = means.map((mean, dimension) => {
      const variance = rawVectors.reduce(
        (sum, vector) => sum + (vector[dimension] - mean) ** 2,
        0,
      ) / Math.max(1, rawVectors.length - 1);
      return Math.sqrt(variance) || 1;
    });
    const standardize = (vector: number[]) =>
      vector.map((value, dimension) => (value - means[dimension]) / deviations[dimension]);
    const realVectors = rawVectors.map(standardize);
    const rng = createRng(20260803);
    const syntheticRaw = Array.from(
      { length: Math.min(6000, Math.max(500, rawVectors.length)) },
      () => {
        const first = rawVectors[Math.floor(rng() * rawVectors.length)];
        let second = rawVectors[Math.floor(rng() * rawVectors.length)];
        if (rawVectors.length > 1) {
          while (second === first) second = rawVectors[Math.floor(rng() * rawVectors.length)];
        }
        const vector = first.map((value, dimension) =>
          dimension < PROJECTION_DIMENSIONS || dimension === PROJECTION_DIMENSIONS + 2
            ? (value + second[dimension]) / 2
            : 0,
        );
        vector[PROJECTION_DIMENSIONS] = Math.log(
          Math.exp(first[PROJECTION_DIMENSIONS]) +
          Math.exp(second[PROJECTION_DIMENSIONS]),
        );
        vector[PROJECTION_DIMENSIONS + 1] = Math.log(
          Math.exp(first[PROJECTION_DIMENSIONS + 1]) +
          Math.exp(second[PROJECTION_DIMENSIONS + 1]) * 0.82,
        );
        return vector;
      },
    );
    const syntheticVectors = syntheticRaw.map(standardize);
    const clusterCount = Math.max(4, Math.min(36, Math.round(Math.sqrt(realVectors.length))));
    const realCentroids = kMeans(realVectors, clusterCount, 701);
    const doubletCentroids = kMeans(syntheticVectors, clusterCount, 1701);
    const logTotals = calledBarcodeIndices.map((index) => Math.log1p(totalCounts[index]));
    const logGenes = calledBarcodeIndices.map((index) => Math.log1p(detectedGenes[index]));
    const totalMedian = median(logTotals);
    const geneMedian = median(logGenes);
    const totalMad = mad(logTotals, totalMedian);
    const geneMad = mad(logGenes, geneMedian);
    const scores = realVectors.map((vector, index) => {
      const realDistance = minimumDistance(vector, realCentroids);
      const doubletDistance = minimumDistance(vector, doubletCentroids);
      const proximity = 1 / (
        1 + Math.exp((doubletDistance - realDistance) / Math.sqrt(vector.length))
      );
      const abundanceZ =
        (logTotals[index] - totalMedian) / totalMad +
        (logGenes[index] - geneMedian) / geneMad;
      const abundance = 1 / (1 + Math.exp(-(abundanceZ - 2) / 1.5));
      return Math.max(0, Math.min(1, 0.72 * proximity + 0.28 * abundance));
    });
    const ranked = scores
      .map((score, index) => ({ score, index }))
      .sort((left, right) => right.score - left.score);
    const expected = Math.max(
      1,
      Math.min(ranked.length, Math.round(ranked.length * settings.expectedDoubletRate)),
    );
    const calledDoublets = new Set(ranked.slice(0, expected).map((entry) => entry.index));
    calledBarcodeIndices.forEach((barcodeIndex, index) => {
      doubletScores[barcodeIndex] = scores[index];
      doubletCalls[barcodeIndex] = calledDoublets.has(index) ? 2 : 1;
    });
  }

  const nCalledCells = calledBarcodeIndices.length;
  const nAmbiguousDroplets = Array.from(cellCalls).filter((call) => call === 1).length;
  const nPredictedDoublets = Array.from(doubletCalls).filter((call) => call === 2).length;
  const cellTotals = calledBarcodeIndices.map((index) => totalCounts[index]);
  const cellGenes = calledBarcodeIndices.map((index) => detectedGenes[index]);
  const scoreValues = calledBarcodeIndices
    .map((index) => doubletScores[index])
    .filter((value) => !Number.isNaN(value));
  const warnings: string[] = [];
  if (settings.expectedCells === 0) {
    warnings.push(
      "The cell-retention knee was estimated automatically. For unusual loading profiles, rerun with the expected recovered-cell count supplied by the experimenter.",
    );
  }
  if (nCalledCells < 100) {
    warnings.push(
      "Fewer than 100 cells were called; doublet scores and distributional diagnostics may be unstable.",
    );
  }
  if (ambientBarcodeCount < 200) {
    warnings.push(
      "The ambient profile is based on fewer than 200 low-count barcodes and should be interpreted cautiously.",
    );
  }

  const analysis: CountQcAnalysis = {
    report: {
      id: reportId,
      softwareVersion: "0.1.0",
      sourceName: matrix.name,
      createdAt: new Date().toISOString(),
      settings,
      summary: {
        nBarcodes: barcodes.length,
        nNonzeroBarcodes: Array.from(totalCounts).filter((value) => value > 0).length,
        nCalledCells,
        nEmptyDroplets: barcodes.length - nCalledCells - nAmbiguousDroplets,
        nAmbiguousDroplets,
        nPredictedDoublets,
        predictedDoubletRate: nCalledCells ? nPredictedDoublets / nCalledCells : 0,
        kneeUmiThreshold,
        ambientBarcodeCount,
        medianCellUmis: median(cellTotals),
        medianGenesPerCell: median(cellGenes),
      },
      umiHistogram: histogram(
        Array.from(totalCounts).filter((value) => value > 0).map((value) => Math.log10(value)),
        24,
      ),
      doubletHistogram: histogram(scoreValues, 20, 0, 1),
      preview: [],
      methods: {
        cellCalling:
          "ReplicateGuard ambient-profile test: high-count barcodes are retained at the barcode-rank knee; remaining candidates are compared with a hashed ambient RNA profile using a multinomial likelihood-ratio statistic and Benjamini-Hochberg FDR control.",
        doubletDetection:
          "ReplicateGuard synthetic-doublet screen: artificial transcriptomes are generated from pairs of called cells, embedded with deterministic sparse random projections, clustered, and compared with real-cell centroids together with library-size and detected-gene features.",
        limitations: [
          "This implementation is inspired by emptyDrops, Scrublet, and scDblFinder but is not a drop-in reproduction of those packages.",
          "Homotypic doublets remain difficult to detect from expression counts alone.",
          "Run each capture library separately and validate important calls with cell hashing, genotype, or orthogonal evidence when available.",
        ],
      },
      warnings,
    },
    barcodes,
    totalCounts,
    detectedGenes,
    mitochondrialCounts,
    ambientPValues,
    ambientFdr,
    cellCalls,
    doubletScores,
    doubletCalls,
  };
  const previewIndices = calledBarcodeIndices
    .sort((left, right) => {
      const scoreDifference = (doubletScores[right] || 0) - (doubletScores[left] || 0);
      return scoreDifference || totalCounts[right] - totalCounts[left];
    })
    .slice(0, 20);
  analysis.report.preview = previewIndices.map((index) => previewRow(analysis, index));
  return analysis;
}

export function countQcRow(analysis: CountQcAnalysis, index: number): CountQcPreviewRow {
  return previewRow(analysis, index);
}
