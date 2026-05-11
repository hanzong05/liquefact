import {jsPDF} from "jspdf";
import type Liquefaction from "../computation/Liquefaction";
import type {LocationParameters} from "../components/LocationParametersModal";
import {
  DEFAULT_PREDICT_TABLE_WEIGHT,
  footingIterationRowsIncludeRockSbcQa,
} from "../computation/liquefactionComputations";

function safeFilenamePart(s: string): string {
  return s.replace(/[^\w-]+/g, "_").slice(0, 48) || "site";
}

function fmt(n: number, d = 4): string {
  return Number.isFinite(n) ? n.toFixed(d) : "-";
}

function parseNum(s: string): number | null {
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

/** Layer index closest to foundation depth for “critical layer” summary lines. */
function criticalLayerIndex(
  analysis: Liquefaction,
  foundationDepthM: number,
): number {
  const rows = analysis.initialParameterTable;
  if (rows.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const d = Math.abs(rows[i]!.depth - foundationDepthM);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export type AnalysisPdfContext = {
  placeName: string;
  analysisLat: number;
  analysisLng: number;
  params: LocationParameters;
  tableWeight?: number;
  /** Distance to nearest dataset borehole (km), if computed in the app. */
  nearestBoreholeKm?: number | null;
  /** When set, liquefaction summary lines use these instead of raw `analysis` ΣLPI / band. */
  calibratedLpiSum?: number;
  calibratedLpiRemark?: string;
  /** Printed under the liquefaction block when calibration is applied. */
  neighborCalibrationNote?: string;
};

const MARGIN = 16;
const PAGE_BOTTOM = 270;
const LINE = 5.2;
const SECTION_GAP = 6;

function ensureSpace(doc: jsPDF, y: number, needMm: number): number {
  if (y + needMm > PAGE_BOTTOM) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

/** Dark green section title bar (print-friendly on white page). */
function drawSectionTitle(doc: jsPDF, y: number, pageW: number, title: string) {
  const barH = 7;
  doc.setFillColor(22, 101, 52);
  doc.rect(MARGIN, y, pageW - 2 * MARGIN, barH, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(title.toUpperCase(), MARGIN + 2.5, y + 4.8);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  return y + barH + 4;
}

function pairLine(
  doc: jsPDF,
  y: number,
  pageW: number,
  label: string,
  value: string,
  unit?: string,
): number {
  doc.setFontSize(9);
  doc.setTextColor(75, 85, 99);
  doc.text(label, MARGIN, y);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  const valueStr = unit ? `${value} ${unit}` : value;
  doc.text(valueStr, pageW - MARGIN, y, {align: "right"});
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  return y + LINE;
}

/**
 * White-background report in the spirit of a liquefaction assessment sheet:
 * section headers and label/value lines only (no data tables).
 */
export function downloadAnalysisPdf(
  analysis: Liquefaction,
  ctx: AnalysisPdfContext,
): void {
  const doc = new jsPDF({orientation: "portrait", unit: "mm", format: "a4"});
  const pageW = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, doc.internal.pageSize.getHeight(), "F");

  const generated = new Date();
  const tw = ctx.tableWeight ?? DEFAULT_PREDICT_TABLE_WEIGHT;
  const rockInFooting = footingIterationRowsIncludeRockSbcQa(
    analysis.footingWidthIterationData,
  );

  doc.setFillColor(15, 23, 42);
  doc.rect(MARGIN, y, pageW - 2 * MARGIN, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("LIQUEFACTION RISK ASSESSMENT REPORT", MARGIN + 2, y + 6.5);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  y += 14;

  doc.setFontSize(8.5);
  doc.setTextColor(82, 82, 91);
  doc.text(
    `Generated: ${generated.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "medium",
    })}`,
    MARGIN,
    y,
  );
  doc.setTextColor(0, 0, 0);
  y += SECTION_GAP + 2;

  y = ensureSpace(doc, y, 40);
  y = drawSectionTitle(doc, y, pageW, "Location");
  y = pairLine(doc, y, pageW, "Location name", ctx.placeName);
  y = pairLine(
    doc,
    y,
    pageW,
    "Latitude",
    fmt(ctx.analysisLat, 6),
    "deg N",
  );
  y = pairLine(
    doc,
    y,
    pageW,
    "Longitude",
    fmt(ctx.analysisLng, 6),
    "deg E",
  );
  const nearKm = ctx.nearestBoreholeKm;
  y = pairLine(
    doc,
    y,
    pageW,
    "Nearest borehole distance",
    nearKm !== null && nearKm !== undefined && Number.isFinite(nearKm)
      ? nearKm.toFixed(2)
      : "-",
    "km",
  );
  y += SECTION_GAP;

  const idx = criticalLayerIndex(analysis, ctx.params.foundationDepthM);
  const iP = analysis.initialParameterTable[idx];
  const gRow = analysis.geotechnicalAnalysisTable[idx];

  y = ensureSpace(doc, y, 52);
  y = drawSectionTitle(doc, y, pageW, "Liquefaction analysis");
  const lpiBandForPdf =
    (ctx.calibratedLpiRemark ?? analysis.totalLpi_remark) || "-";
  const sumLpiForPdf =
    ctx.calibratedLpiSum !== undefined &&
    Number.isFinite(ctx.calibratedLpiSum)
      ? ctx.calibratedLpiSum.toFixed(2)
      : analysis.totalLpi || "0";
  y = pairLine(doc, y, pageW, "LPI hazard band", lpiBandForPdf);
  y = pairLine(doc, y, pageW, "Sum LPI (profile)", sumLpiForPdf);
  if (ctx.neighborCalibrationNote) {
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(ctx.neighborCalibrationNote, MARGIN, y, {
      maxWidth: pageW - 2 * MARGIN,
    });
    doc.setTextColor(0, 0, 0);
    y += LINE + 3;
  }
  if (rockInFooting) {
    doc.setFontSize(8);
    doc.setTextColor(22, 101, 52);
    doc.text(
      "Note: Rock in iterated SBC influence zone - sum LPI taken as 0.",
      MARGIN,
      y,
      {maxWidth: pageW - 2 * MARGIN},
    );
    doc.setTextColor(0, 0, 0);
    y += LINE + 1;
  }
  const minFs = (() => {
    let m: number | null = null;
    for (const r of analysis.geotechnicalAnalysisTable) {
      const v = parseNum(r.fs);
      if (v === null) continue;
      if (m === null || v < m) m = v;
    }
    return m;
  })();
  y = pairLine(
    doc,
    y,
    pageW,
    "Minimum factor of safety (profile)",
    minFs !== null ? minFs.toFixed(3) : "-",
  );
  y = pairLine(
    doc,
    y,
    pageW,
    "Model data source",
    `POST /predict (weight ${tw}) + LPI`,
  );
  y += SECTION_GAP;

  y = ensureSpace(doc, y, 48);
  y = drawSectionTitle(doc, y, pageW, "Soil parameters (critical layer)");
  if (iP && gRow) {
    y = pairLine(doc, y, pageW, "Depth (z)", String(iP.depth), "m");
    y = pairLine(doc, y, pageW, "SPT N60", String(iP.n60), "blows/ft");
    y = pairLine(
      doc,
      y,
      pageW,
      "Unit weight (gamma)",
      fmt(iP.totalUnitWeight, 2),
      "kN/m3",
    );
    const csr = parseNum(gRow.csr);
    const crr = parseNum(gRow.crr75);
    y = pairLine(
      doc,
      y,
      pageW,
      "Cyclic stress ratio (CSR)",
      csr !== null ? csr.toFixed(4) : cellStr(gRow.csr),
    );
    y = pairLine(
      doc,
      y,
      pageW,
      "Cyclic resistance ratio (CRR, M=7.5)",
      crr !== null ? crr.toFixed(4) : cellStr(gRow.crr75),
    );
    y = pairLine(
      doc,
      y,
      pageW,
      "Groundwater level (GWL)",
      fmt(iP.groundWaterLevel, 2),
      "m",
    );
    y = pairLine(
      doc,
      y,
      pageW,
      "Fines content",
      fmt(iP.finesContent, 1),
      "%",
    );
    y = pairLine(doc, y, pageW, "Soil type (design)", String(iP.soilType));
  } else {
    doc.setFontSize(9);
    doc.text("-", MARGIN, y);
    y += LINE;
  }
  y += SECTION_GAP;

  y = ensureSpace(doc, y, 36);
  y = drawSectionTitle(doc, y, pageW, "Soil performance");
  const foot = analysis.finalFootingWidthIterationPassedData;
  const sbcVal =
    foot && typeof foot.sbc_qa_new === "number"
      ? {text: foot.sbc_qa_new.toFixed(0), unit: "kPa"}
      : foot
        ? {text: String(foot.sbc_qa_new), unit: ""}
        : {text: "-", unit: ""};
  y = pairLine(
    doc,
    y,
    pageW,
    "Allowable bearing (SBC qa new, iterated)",
    sbcVal.text,
    sbcVal.unit,
  );
  const settMm =
    foot && Number.isFinite(Number.parseFloat(foot.totalSettlement))
      ? Number.parseFloat(foot.totalSettlement).toFixed(1)
      : "-";
  y = pairLine(doc, y, pageW, "Total settlement", settMm, "mm");
  y = pairLine(
    doc,
    y,
    pageW,
    "Liquefaction potential index (sum LPI)",
    analysis.totalLpi || "0",
  );
  y = pairLine(doc, y, pageW, "LPI remark", analysis.totalLpi_remark || "-");
  y += SECTION_GAP;

  y = ensureSpace(doc, y, 32);
  y = drawSectionTitle(doc, y, pageW, "Foundation recommendation");
  if (analysis.passed && foot) {
    y = pairLine(
      doc,
      y,
      pageW,
      "Base width (B)",
      fmt(foot.footingWidth, 2),
      "m",
    );
    pairLine(
      doc,
      y,
      pageW,
      "Foundation depth (D)",
      fmt(ctx.params.foundationDepthM, 2),
      "m",
    );
  } else {
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(
      "Footing iteration did not pass tolerable settlement - consider other foundation types.",
      MARGIN,
      y,
      {maxWidth: pageW - 2 * MARGIN},
    );
    doc.setTextColor(0, 0, 0);
  }

  doc.setFontSize(7.5);
  doc.setTextColor(113, 113, 122);
  doc.text(
    "LIQUEFACT - summary export. Verify against site investigation and project criteria.",
    MARGIN,
    doc.internal.pageSize.getHeight() - 10,
    {maxWidth: pageW - 2 * MARGIN},
  );

  const name = `Liquefact_${safeFilenamePart(ctx.placeName)}_${generated.toISOString().slice(0, 10)}.pdf`;
  doc.save(name);
}

function cellStr(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max - 1)}...` : s;
}
