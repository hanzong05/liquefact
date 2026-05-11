import nerdamerLoaded from "nerdamer/all.js";

interface NerdamerInstance {
  solveEquations: (equation: string, variable: string) => NerdamerInstance[];
  evaluate: (values?: Record<string, number>) => NerdamerInstance;
  text: (format?: string) => string;
  map: <T>(callback: (item: NerdamerInstance) => T) => T[];
  find: <T>(callback: (item: T) => boolean) => T | undefined;
}

interface NerdamerFunction {
  (expression: string): NerdamerInstance;
  solveEquations: (equation: string, variable: string) => NerdamerInstance[];
  ceil: (value: number) => NerdamerInstance;
}

/** Full nerdamer bundle (CJS `all.js`); narrowed to our call surface. */
const nerdamer = nerdamerLoaded as unknown as NerdamerFunction;

// Dynamic import helper for mathjs
type MathJsLite = {
  evaluate: (expr: string, scope?: Record<string, number>) => unknown;
  derivative: (expr: string, variable: string) => {toString: () => string};
  equal: (a: unknown, b: unknown) => boolean;
};

let mathJsModule: MathJsLite | null = null;

async function getMathJs(): Promise<MathJsLite> {
  if (!mathJsModule) {
    mathJsModule = (await import("mathjs")) as MathJsLite;
  }
  return mathJsModule;
}

export async function solveForX(
  equation: string,
  letter: string,
): Promise<string | null> {
  const nerdamer_result = await solveForX_nerdamer(equation, letter);
  if (!parseFloat(nerdamer_result || "")) {
    return await solveForX_newton(equation, letter);
  }
  return nerdamer_result;
}

export async function solveForX_nerdamer(
  equation: string,
  letter: string,
): Promise<string | null> {
  try {
    const sol: string[] = nerdamer
      .solveEquations(equation, letter)
      .map((solution: NerdamerInstance) =>
        nerdamer(solution.text()).evaluate().text(),
      );

    return sol.find((value: string) => parseFloat(value) > 0) || null;
  } catch (error) {
    console.error("Nerdamer solve error:", error);
    return null;
  }
}

export async function solveForX_newton(
  equation: string,
  letter: string,
  guess: number = 1,
  maxIterations: number = 100,
  tolerance: number = 1e-7,
): Promise<string | null> {
  try {
    const mathjs = await getMathJs();
    let c = guess; // Initial guess

    for (let i = 0; i < maxIterations; i++) {
      // Create evaluation context
      const context: Record<string, number> = {};
      context[letter] = c;

      // Evaluate f(c)
      const f_c = mathjs.evaluate(equation, context);

      // Evaluate f'(c) (derivative)
      const derivativeExpr = mathjs.derivative(equation, letter).toString();
      const f_prime_c = mathjs.evaluate(derivativeExpr, context);

      if (Math.abs(f_prime_c as number) < tolerance) {
        throw new Error(
          "Derivative too small; Newton's method may not converge.",
        );
      }

      // Newton's iteration formula
      const c_new = c - (f_c as number) / (f_prime_c as number);

      // Check for convergence
      if (Math.abs(c_new - c) < tolerance) {
        return c_new.toString(); // Solution found
      }

      c = c_new;
    }

    throw new Error("Newton's method did not converge.");
  } catch (error) {
    console.error("Newton method error:", error);
    return null;
  }
}

export function compute(equation: string): number {
  try {
    const result = parseFloat(nerdamer(equation).text("decimals"));
    return result;
  } catch (error) {
    console.error("Compute error:", error);
    return 0;
  }
}

export function computeString(equation: string): string {
  try {
    const result = nerdamer(equation).evaluate().text();
    return result;
  } catch (error) {
    console.error("Compute string error:", error);
    return "";
  }
}

export function substitute(equation: string, cValue: number): string {
  try {
    const substitutedResult = nerdamer(equation)
      .evaluate({c: cValue})
      .text("decimals");
    return substitutedResult.toString();
  } catch (error) {
    console.error("Substitute error:", error);
    return "";
  }
}

export async function compare(equation: string): Promise<boolean> {
  try {
    const mathjs = await getMathJs();
    return Boolean(mathjs.evaluate(equation));
  } catch (error) {
    console.log("Comparing equation:", equation);
    console.error("Compare error:", error);
    return false;
  }
}

export async function compareIfEqual(
  leftEquation: string,
  rightEquation: string,
): Promise<boolean> {
  try {
    const mathjs = await getMathJs();
    const left = mathjs.evaluate(leftEquation);
    const right = mathjs.evaluate(rightEquation);
    return mathjs.equal(left, right);
  } catch (error) {
    console.error("Compare if equal error:", error);
    return false;
  }
}

export function roundUpToNearest(
  num: number | string,
  multiple: number | string,
): string {
  try {
    return nerdamer(`ceil(${num} / ${multiple}) * ${multiple}`)
      .evaluate()
      .text();
  } catch (error) {
    console.error("Round up error:", error);
    return "0";
  }
}

/** One criterion: same-length range as `averageRange`, plus value or expression (see `averageIfs`). */
export type AverageIfsCriterion = readonly [
  criteriaRange: readonly number[],
  criteria: string | number,
];

/**
 * Excel `AVERAGEIFS(average_range, criteria_range1, criteria1, …)`:
 * averages values in `averageRange` where every row satisfies all criteria
 * (AND). Ranges must be the same length.
 *
 * Criteria behavior (aligned with Excel):
 * - `number`: equality on that row’s `criteriaRange` value.
 * - `string` starting with `>=`, `<=`, `<>`, `<`, `>`, or `=`: numeric comparison
 *   (e.g. `">=10"`, `"<>0"`).
 * - Other `string`: text match on `String(cell)` with `*` and `?` wildcards.
 *
 * Returns `NaN` when there are no matching rows (Excel `#DIV/0!`). With no
 * criterion pairs, returns the plain average of `averageRange` (empty array → `NaN`).
 */
export function averageIfs(
  averageRange: readonly number[],
  ...criteriaList: AverageIfsCriterion[]
): number {
  const n = averageRange.length;
  if (n === 0) return NaN;

  for (const [range] of criteriaList) {
    if (range.length !== n) {
      throw new RangeError(
        "averageIfs: all ranges must have the same length as averageRange",
      );
    }
  }

  const rowMatches = (row: number): boolean => {
    for (const [criteriaRange, criteria] of criteriaList) {
      if (!cellMatchesCriteria(criteriaRange[row]!, criteria)) return false;
    }
    return true;
  };

  if (criteriaList.length === 0) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += averageRange[i]!;
    return sum / n;
  }

  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (rowMatches(i)) {
      sum += averageRange[i]!;
      count++;
    }
  }
  return count === 0 ? NaN : sum / count;
}

function cellMatchesCriteria(
  cellValue: number,
  criteria: string | number,
): boolean {
  if (typeof criteria === "number") {
    return cellValue === criteria;
  }
  const s = criteria.trim();
  const opMatch = s.match(/^(>=|<=|<>|<|>|=)\s*(.+)$/);
  if (opMatch) {
    const op = opMatch[1]!;
    const rhsRaw = opMatch[2]!.trim();
    const rhs = Number(rhsRaw);
    if (Number.isNaN(rhs)) return false;
    switch (op) {
      case ">=":
        return cellValue >= rhs;
      case "<=":
        return cellValue <= rhs;
      case "<>":
        return cellValue !== rhs;
      case "<":
        return cellValue < rhs;
      case ">":
        return cellValue > rhs;
      case "=":
        return cellValue === rhs;
      default:
        return false;
    }
  }
  return wildcardMatch(String(cellValue), s);
}

/** Excel-style `*` (any run) and `?` (one char); `~` escapes next char. */
function wildcardMatch(value: string, pattern: string): boolean {
  const regex = wildcardPatternToRegex(pattern);
  return regex.test(value);
}

function wildcardPatternToRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "~" && i + 1 < pattern.length) {
      re += escapeRegexChar(pattern[++i]!);
      continue;
    }
    if (c === "*") {
      re += ".*";
      continue;
    }
    if (c === "?") {
      re += ".";
      continue;
    }
    re += escapeRegexChar(c);
  }
  return new RegExp(`^${re}$`, "i");
}

function escapeRegexChar(c: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(c) ? `\\${c}` : c;
}

export function roundToTwoDecimals(numStr: string | undefined) {
  if (!numStr) return undefined;
  let num = parseFloat(numStr);
  if (isNaN(num)) return "Invalid input";
  return parseFloat(num.toFixed(2)).toString();
}
