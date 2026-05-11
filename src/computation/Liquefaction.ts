import type {LiquefactionFormInputs} from "../pages/AnalysisPage";
import {
  runModel,
  computeGeotechnicalAnalysis,
  iterateFootingWidths,
  applyZeroLpiIfFootingIterationsIncludeRock,
  type GeotechnicalAnalysisTable,
  type initialParameterTableType,
  type FootingWidthIterationDataType,
  type RunModelOptions,
} from "./liquefactionComputations";

// To make this documentation fully operational for a developer or engineer, here is the complete mapping of the Excel column indices to the specific formulas used within those cells.

// ### **Section 1: Geotechnical & Liquefaction Analysis (Columns A–AH)**

// | Col | Header Name | Formula / Computational Logic |
// | --- | --- | --- |
// | **A** | No. of Boreholes | *Manual Input* |
// | **B** | Latitude | *Manual Input* |
// | **C** | Longitude | *Manual Input* |
// | **D** | Depth (z) | *Manual Input* |
// | **E** | Layer Thickness (z2) | *Manual Input* |
// | **F** | Total Unit Weight (y) | *Manual Input* |
// | **G** | N60 | *Manual Input* |
// | **H** | Fines Content (FC) | *Manual Input* |
// | **I** | Magnitude | *Global Constant* |
// | **J** | Peak Ground Acceleration (PGA) | *Global Constant* |
// | **K** | Ground Water Level (GWL) | *Global Constant* |
// | **L** | Soil Type | *Manual Input* |
// | **M** | Pore Pressure (u) | `IF(z > GWL, (z - GWL) * 9.81, 0)` |
// | **N** | Total Stress (Ot) | `Previous_Ot + (y * z2)` |
// | **O** | Effective Stress | `Ot - u` |
// | **P** | Cn | `min(sqrt(100 / Effective_Stress), 1.7)` |
// | **Q** | N160 | `N60 * Cn` |
// | **R** | N160_2 ($\Delta N$) | `exp(1.63 + (9.7 / (FC + 0.01)) - (15.7 / (FC + 0.01))^2)` |
// | **S** | N160cs | `N160 + N160_2` |
// | **T** | m | `0.3 + 0.7 * exp(-N160cs / 20)` *(Simplified Idriss)* |
// | **U** | Cn_final | `(100 / Effective_Stress)^m` *(capped at 1.7)* |
// | **V** | N160cs_final | `N60 * Cn_final + N160_2` |
// | **W** | rd | `1.0 - 0.00765 * z` *(if z < 9.15m)* |
// | **X** | CSR | `0.65 * PGA * (Ot / Effective_Stress) * rd` |
// | **Y** | MSFmax | `1.8` *(Standard cap)* |
// | **Z** | MSF | `6.9 * exp(-Magnitude / 4) - 0.058` |
// | **AA** | Ko | `1 - (LOG(Effective_Stress / 100) * 0.3)` |
// | **AB** | CRR7.5 | `exp((N160cs/14.1) + (N160cs/126)^2 - (N160cs/23.6)^3 + (N160cs/25.4)^4 - 2.8)` |
// | **AC** | FS | `(CRR7.5 / CSR) * MSF * Ko` |
// | **AD** | Remarks | `IF(FS < 1, "LIQUEFIABLE", "NOT LIQUEFIABLE")` |
// | **AE** | Severity (Fi) | `IF(FS < 1, 1 - FS, 0)` |
// | **AF** | Weighting Factor | `10 - 0.5 * z` |
// | **AG** | LPI | `Fi * Weighting_Factor * z2` |
// | **AH** | Remarks.1 | `LOOKUP(LPI_Sum, [0, 5, 15], ["Low", "High", "Very High"])` |

// ---

// ### **Section 2: Bearing Capacity (SBC) (Columns AI–AS)**

// | Col | Header Name | Formula / Computational Logic |
// | --- | --- | --- |
// | **AI** | Footing Width, B | *Manual Design Input* |
// | **AJ** | Depth of Footing, Df | *Manual Design Input* |
// | **AK** | Tolerable Settlement | *Constant (usually 25 or 50)* |
// | **AL** | Depth Factor, Fd | `1 + 0.33 * (Df / B)` *(capped at 1.33)* |
// | **AM** | N | `AVERAGE(N60_in_bearing_zone)` |
// | **AN** | N_Design | `0.55 * N` *(Correction for silty sands if applicable)* |
// | **AO** | Nc | `Table_Lookup(Soil_Type, Friction_Angle)` |
// | **AP** | SBC (qa) | `11.98 * N_Design * Fd * (Tolerable_Settlement / 25)` |
// | **AQ** | SBC (qa) NEW | `IF(Soil_Type="ML", "Manual Analysis", SBC_qa)` |
// | **AR** | SBC (qa) NEW (Final) | `AQ Value` |
// | **AS** | REMARKS | `Logic check based on soil classification` |

// ---

// ### **Section 3: Settlement Analysis (Columns AT–BW)**

// | Col | Header Name | Formula / Computational Logic |
// | --- | --- | --- |
// | **AW** | Building Load (P) - KN | *Manual Input* |
// | **BA** | Modulus of Elasticity | `α * N60` *(where α is 500 to 1000 depending on soil)* |
// | **BC** | q(gross) | `(P / B^2) + (Weight_of_Footing / B^2)` |
// | **BI** | Net Contact Pressure (qn) | `q_gross - (y * Df)` |
// | **BK** | Peak Strain Factor (Izp) | `0.5 + 0.1 * sqrt(qn / Effective_Stress_at_Df)` |
// | **BL** | Strain Influence (Iz) | `Interpolate(z, Izp, Schmertmann_Triangle)` |
// | **BN** | Correction Factor (C1) | `1 - 0.5 * (Effective_Stress_at_Df / qn)` |
// | **BP** | Correction Factor (C2) | `1 + 0.2 * LOG10(t / 0.1)` |
// | **BQ** | Elastic Settlement | `C1 * C2 * qn * (Iz / Modulus) * z2` |
// | **BT** | Volumetric Strain | `Derived from FS and Relative Density (Dr)` |
// | **BU** | Volumetric Settlement | `Volumetric_Strain * z2` |
// | **BV** | Settlement | `SUM(BQ) + SUM(BU)` |
// | **BW** | Remarks.3 | `IF(Settlement < Tolerable, "SAFE", "RE-DESIGN")` |

export default class Liquefaction {
  // Input Values
  latitude: number;
  longitude: number;

  foundationDepth: number;
  buildingLoad: number;
  earthquakeMagnitude: number;
  elapsedTimeInYears: number;

  // Computed Values
  noOfBoreholes: number;
  depth: number;
  listOfDepths: number[];
  initialParameterTable: initialParameterTableType[];
  geotechnicalAnalysisTable: GeotechnicalAnalysisTable[];
  totalLpi: string;
  totalLpi_remark: string;

  footingWidth: string;
  depthOfFooting: string;
  tolerableSettlement: string;
  depthFactor: string;
  n: string;
  nDesign: string;
  nc: string;
  sbcQa: string;
  sbcQaNew: string;
  sbcQaNewFinal: string;
  remarks_sbc: string;

  footingWidthIterationData: FootingWidthIterationDataType[];
  finalFootingWidthIterationPassedData: FootingWidthIterationDataType | null;
  passed: boolean;

  constructor() {
    this.latitude = 0;
    this.longitude = 0;
    this.noOfBoreholes = 0;
    this.depth = 0;
    this.buildingLoad = 0;
    this.elapsedTimeInYears = 0;
    this.earthquakeMagnitude = 0;
    this.foundationDepth = 0;
    this.listOfDepths = [];
    this.initialParameterTable = [];
    this.geotechnicalAnalysisTable = [];
    this.totalLpi = "0";
    this.totalLpi_remark = "";
    this.footingWidth = "0";
    this.depthOfFooting = "0";
    this.tolerableSettlement = "0";
    this.depthFactor = "0";
    this.n = "0";
    this.nDesign = "0";
    this.nc = "0";
    this.sbcQa = "0";
    this.sbcQaNew = "0";
    this.sbcQaNewFinal = "0";
    this.remarks_sbc = "";
    this.footingWidthIterationData = [];
    this.finalFootingWidthIterationPassedData = null;
    this.passed = false;
  }

  /**
   * Runs `/predict` per depth, geotechnical liquefaction table, then footing
   * iteration (SBC + settlement). Pass `signal` to cancel in-flight requests.
   */
  async computeLiquefaction(options?: RunModelOptions): Promise<void> {
    try {
      const runResult = await runModel(this, options);
      Object.assign(this, runResult);
      const geoResult = await computeGeotechnicalAnalysis(this);
      Object.assign(this, geoResult);
      const footingResult = await iterateFootingWidths(this);
      Object.assign(this, footingResult);
      applyZeroLpiIfFootingIterationsIncludeRock(this);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to compute liquefaction: ${message}`, {
        cause: error,
      });
    }
  }

  assignValues(values: Record<string, unknown>): void {
    Object.assign(this, values);
  }

  getInputValues(): LiquefactionFormInputs {
    return {
      latitude: this.latitude,
      longitude: this.longitude,
      foundationDepth: this.foundationDepth,
      buildingLoad: this.buildingLoad,
      earthquakeMagnitude: this.earthquakeMagnitude,
      elapsedTimeInYears: this.elapsedTimeInYears,
    };
  }
}
