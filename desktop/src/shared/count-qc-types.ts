export type CountQcSettings = {
  expectedCells: number;
  ambientMaxUmis: number;
  minimumCandidateUmis: number;
  cellCallingFdr: number;
  expectedDoubletRate: number;
};

export type CountMatrixSummary = {
  id: string;
  name: string;
  directory: string;
  matrixFile: string;
  barcodesFile: string;
  featuresFile: string;
  nBarcodes: number;
  nFeatures: number;
  nNonZero: number;
};

export type CountQcPreviewRow = {
  barcode: string;
  totalCounts: number;
  detectedGenes: number;
  mitochondrialFraction: number;
  ambientPValue: number | null;
  ambientFdr: number | null;
  cellCall: "cell" | "empty" | "ambiguous";
  doubletScore: number | null;
  doubletCall: "doublet" | "singlet" | "not_tested";
};

export type HistogramBin = {
  lower: number;
  upper: number;
  count: number;
};

export type CountQcReport = {
  id: string;
  softwareVersion: string;
  sourceName: string;
  createdAt: string;
  settings: CountQcSettings;
  summary: {
    nBarcodes: number;
    nNonzeroBarcodes: number;
    nCalledCells: number;
    nEmptyDroplets: number;
    nAmbiguousDroplets: number;
    nPredictedDoublets: number;
    predictedDoubletRate: number;
    kneeUmiThreshold: number;
    ambientBarcodeCount: number;
    medianCellUmis: number;
    medianGenesPerCell: number;
  };
  umiHistogram: HistogramBin[];
  doubletHistogram: HistogramBin[];
  preview: CountQcPreviewRow[];
  methods: {
    cellCalling: string;
    doubletDetection: string;
    limitations: string[];
  };
  warnings: string[];
};

export type SaveCountQcRequest = {
  reportId: string;
  format: "html" | "json" | "csv";
};

