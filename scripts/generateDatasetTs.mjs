import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const inputCsvPath = path.join(
  projectRoot,
  "src",
  "utils",
  "constants",
  "dataset.csv",
);
const outputTypePath = path.join(
  projectRoot,
  "src",
  "utils",
  "constants",
  "datasetBoreholes.type.ts",
);
const outputDataPath = path.join(
  projectRoot,
  "src",
  "utils",
  "constants",
  "datasetBoreholes.ts",
);

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  values.push(current.trim());
  return values;
}

function parseNumberOrNull(value, columnName, rowNumber, warnings) {
  if (value === "") return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) {
    warnings.push(
      `Row ${rowNumber}, column "${columnName}" has non-numeric value "${value}" -> stored as null`,
    );
    return null;
  }
  return n;
}

function toRecord(row, rowNumber, warnings) {
  return {
    latitude: parseNumberOrNull(row.Latitude, "Latitude", rowNumber, warnings),
    longitude: parseNumberOrNull(
      row.Longitude,
      "Longitude",
      rowNumber,
      warnings,
    ),
    depthOfSoil: parseNumberOrNull(
      row.DepthOfSoil,
      "DepthOfSoil",
      rowNumber,
      warnings,
    ),
    totalUnitWeight: parseNumberOrNull(
      row.TotalUnitWeight,
      "TotalUnitWeight",
      rowNumber,
      warnings,
    ),
    n60: parseNumberOrNull(row.N60, "N60", rowNumber, warnings),
    finesContent: parseNumberOrNull(
      row.FinesContent,
      "FinesContent",
      rowNumber,
      warnings,
    ),
    peakGroundAcceleration: parseNumberOrNull(
      row.PeakGroundAcceleration,
      "PeakGroundAcceleration",
      rowNumber,
      warnings,
    ),
    groundWaterLevel: parseNumberOrNull(
      row.GoundWaterLevel,
      "GoundWaterLevel",
      rowNumber,
      warnings,
    ),
    soilType: row.SoilType,
    modulusOfElasticity: parseNumberOrNull(
      row.ModulusOfElasticity,
      "ModulusOfElasticity",
      rowNumber,
      warnings,
    ),
  };
}

function createTypeFileContent() {
  return `export interface DatasetBoreholeDepthRow {
  depthOfSoil: number | null;
  totalUnitWeight: number | null;
  n60: number | null;
  finesContent: number | null;
  peakGroundAcceleration: number | null;
  groundWaterLevel: number | null;
  soilType: string;
  modulusOfElasticity: number | null;
}

export interface DatasetBorehole {
  boreholeId: string;
  latitude: number | null;
  longitude: number | null;
  depthRows: DatasetBoreholeDepthRow[];
}
`;
}

function createDataFileContent(boreholes) {
  const dataJson = JSON.stringify(boreholes, null, 2);
  return `import type {DatasetBorehole} from "./datasetBoreholes.type";

export const datasetBoreholes: DatasetBorehole[] = ${dataJson};
`;
}

function toBoreholeKey(record) {
  return `${record.latitude ?? "null"}|${record.longitude ?? "null"}`;
}

function sortByDepthAscending(a, b) {
  if (a.depthOfSoil === null && b.depthOfSoil === null) return 0;
  if (a.depthOfSoil === null) return 1;
  if (b.depthOfSoil === null) return -1;
  return a.depthOfSoil - b.depthOfSoil;
}

function groupByBorehole(records) {
  const grouped = new Map();

  for (const record of records) {
    const key = toBoreholeKey(record);
    const entry = grouped.get(key);

    const depthRow = {
      depthOfSoil: record.depthOfSoil,
      totalUnitWeight: record.totalUnitWeight,
      n60: record.n60,
      finesContent: record.finesContent,
      peakGroundAcceleration: record.peakGroundAcceleration,
      groundWaterLevel: record.groundWaterLevel,
      soilType: record.soilType,
      modulusOfElasticity: record.modulusOfElasticity,
    };

    if (!entry) {
      grouped.set(key, {
        latitude: record.latitude,
        longitude: record.longitude,
        depthRows: [depthRow],
      });
      continue;
    }

    entry.depthRows.push(depthRow);
  }

  const boreholes = [];
  let boreholeIndex = 1;
  for (const value of grouped.values()) {
    value.depthRows.sort(sortByDepthAscending);
    boreholes.push({
      boreholeId: `No.${boreholeIndex}`,
      latitude: value.latitude,
      longitude: value.longitude,
      depthRows: value.depthRows,
    });
    boreholeIndex += 1;
  }

  return boreholes;
}

async function run() {
  const csvRaw = await readFile(inputCsvPath, "utf8");
  const lines = csvRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("dataset.csv must include a header and at least one row.");
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1);
  const warnings = [];

  const records = rows.map((line, idx) => {
    const values = parseCsvLine(line);
    if (values.length !== headers.length) {
      throw new Error(
        `Column mismatch at row ${idx + 2}: expected ${headers.length}, got ${values.length}`,
      );
    }

    const row = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
    return toRecord(row, idx + 2, warnings);
  });

  const boreholes = groupByBorehole(records);

  await mkdir(path.dirname(outputTypePath), {recursive: true});
  await writeFile(outputTypePath, createTypeFileContent(), "utf8");
  await writeFile(outputDataPath, createDataFileContent(boreholes), "utf8");

  console.log(
    `Generated ${records.length} rows into ${boreholes.length} boreholes:\n- ${path.relative(projectRoot, outputTypePath)}\n- ${path.relative(projectRoot, outputDataPath)}`,
  );
  if (warnings.length > 0) {
    console.warn(`Completed with ${warnings.length} warning(s).`);
    console.warn(warnings.slice(0, 10).join("\n"));
    if (warnings.length > 10) {
      console.warn(`...and ${warnings.length - 10} more warning(s).`);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
