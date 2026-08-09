export type MetadataRow = Record<string, string>;

export type ParsedTable = {
  columns: string[];
  rows: MetadataRow[];
  delimiter: "," | "\t";
};

function detectDelimiter(text: string): "," | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim());
      records.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    records.push(row);
  }
  return records.filter((record) => record.some((value) => value !== ""));
}

export function parseDelimited(text: string): ParsedTable {
  const cleaned = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(cleaned);
  const records = parseRecords(cleaned, delimiter);
  if (records.length < 2) {
    throw new Error("The table must contain a header row and at least one data row.");
  }

  const rawHeader = [...records[0]];
  const dataWidth = Math.max(...records.slice(1).map((record) => record.length));
  // GEO/R data frames commonly export row names without a header cell.
  if (dataWidth === rawHeader.length + 1) rawHeader.unshift("");

  const seen = new Map<string, number>();
  const columns = rawHeader.map((raw, index) => {
    const base = raw || (index === 0 ? "row_id" : `column_${index + 1}`);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
  const rows = records.slice(1).map((values) =>
    Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""])),
  );
  return { columns, rows, delimiter };
}

async function decompressGzip(buffer: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress .gz files. Decompress the file to TSV or CSV before uploading.");
  }
  const stream = new Blob([buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export async function readMetadataFile(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith(".gz")) {
    return decompressGzip(await file.arrayBuffer());
  }
  return file.text();
}

export async function readMetadataResponse(
  response: Response,
  sourceName: string,
): Promise<string> {
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (
    sourceName.toLowerCase().endsWith(".gz") ||
    contentType.includes("gzip") ||
    contentType.includes("x-gzip")
  ) {
    return decompressGzip(await response.arrayBuffer());
  }
  return response.text();
}

export function addKnownDerivedColumns(table: ParsedTable): ParsedTable {
  if (
    !table.columns.includes("sample_id") &&
    table.columns.includes("ind") &&
    table.columns.includes("stim")
  ) {
    return {
      ...table,
      columns: [...table.columns, "sample_id"],
      rows: table.rows.map((row) => ({
        ...row,
        sample_id: `${row.ind}__${row.stim}`,
      })),
    };
  }
  return table;
}
