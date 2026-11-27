import Decimal from "decimal.js";

/**
 * Splitting a gross salary by a salary structure. Pure (no database), so the
 * employee form, the demo data and the tests all agree.
 *
 * A structure is a list of lines, one per salary head on the employee:
 *   BASIC → basic, HRA → hra, CONV → conveyance, SPECIAL → specialAllowance,
 *   OTHER → otherAllowance.
 * Each line is worked out as
 *   PERCENT_OF_GROSS  value% of the monthly gross
 *   PERCENT_OF_BASIC  value% of the basic (so BASIC itself can't use it)
 *   FIXED             value rupees
 *   BALANCE           whatever is left of the gross after the other lines
 * Amounts are rounded to the structure's decimals; the BALANCE line takes the
 * rounding difference, so the heads always add up to the gross exactly.
 */

export type StructureComponent = "BASIC" | "HRA" | "CONV" | "SPECIAL" | "OTHER";
export type StructureCalcType = "PERCENT_OF_GROSS" | "PERCENT_OF_BASIC" | "FIXED" | "BALANCE";

export interface StructureLine {
  component: StructureComponent;
  calcType: StructureCalcType;
  value: number;
}

export interface SalarySplit {
  basic: Decimal;
  hra: Decimal;
  conveyance: Decimal;
  specialAllowance: Decimal;
  otherAllowance: Decimal;
}

export const COMPONENT_FIELD: Record<StructureComponent, keyof SalarySplit> = {
  BASIC: "basic",
  HRA: "hra",
  CONV: "conveyance",
  SPECIAL: "specialAllowance",
  OTHER: "otherAllowance",
};

export const COMPONENT_LABELS: Record<StructureComponent, string> = {
  BASIC: "Basic",
  HRA: "House rent allowance",
  CONV: "Conveyance",
  SPECIAL: "Special allowance",
  OTHER: "Other allowance",
};

export const CALC_TYPE_LABELS: Record<StructureCalcType, string> = {
  PERCENT_OF_GROSS: "% of gross",
  PERCENT_OF_BASIC: "% of basic",
  FIXED: "Fixed amount (₹)",
  BALANCE: "Balance (rest of gross)",
};

/** Problems that make a structure unusable, as [line index or null, message]. Empty = fine. */
export function structureProblems(lines: StructureLine[]): [number | null, string][] {
  const out: [number | null, string][] = [];
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (seen.has(l.component)) out.push([i, `${COMPONENT_LABELS[l.component]} is listed twice`]);
    seen.add(l.component);
    if (l.component === "BASIC" && l.calcType === "PERCENT_OF_BASIC") out.push([i, "Basic can't be a percentage of itself"]);
    if (l.calcType.startsWith("PERCENT") && (l.value <= 0 || l.value > 100)) out.push([i, "Give a percentage between 0 and 100"]);
    if (l.calcType === "FIXED" && l.value < 0) out.push([i, "Can't be negative"]);
  });
  const balances = lines.filter((l) => l.calcType === "BALANCE").length;
  if (balances > 1) out.push([null, "Only one line can take the balance"]);
  if (balances === 0) out.push([null, "Make one line the balance (usually Special allowance) so the heads add up to the gross"]);
  if (lines.some((l) => l.calcType === "PERCENT_OF_BASIC") && !lines.some((l) => l.component === "BASIC")) {
    out.push([null, "A line is a % of basic, so the structure needs a Basic line"]);
  }
  return out;
}

/**
 * Splits a monthly gross. Throws when the fixed and percentage lines already
 * come to more than the gross (the balance would be negative).
 */
export function splitSalary(lines: StructureLine[], monthlyGross: Decimal.Value, roundingDecimals = 0): SalarySplit {
  const gross = new Decimal(monthlyGross || 0);
  const dp = roundingDecimals === 2 ? 2 : 0;
  const round = (v: Decimal) => v.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
  const split: SalarySplit = {
    basic: new Decimal(0),
    hra: new Decimal(0),
    conveyance: new Decimal(0),
    specialAllowance: new Decimal(0),
    otherAllowance: new Decimal(0),
  };

  const basicLine = lines.find((l) => l.component === "BASIC");
  const amountOf = (l: StructureLine, basic: Decimal): Decimal => {
    if (l.calcType === "PERCENT_OF_GROSS") return round(gross.times(l.value).div(100));
    if (l.calcType === "PERCENT_OF_BASIC") return round(basic.times(l.value).div(100));
    if (l.calcType === "FIXED") return round(new Decimal(l.value || 0));
    return new Decimal(0);
  };
  // Basic first: the "% of basic" lines depend on it.
  const basic = basicLine && basicLine.calcType !== "BALANCE" ? amountOf(basicLine, new Decimal(0)) : new Decimal(0);
  if (basicLine && basicLine.calcType !== "BALANCE") split.basic = basic;

  for (const l of lines) {
    if (l.component === "BASIC" || l.calcType === "BALANCE") continue;
    split[COMPONENT_FIELD[l.component]] = amountOf(l, basic);
  }

  const used = Object.values(split).reduce((t, v) => t.plus(v), new Decimal(0));
  const rest = gross.minus(used);
  if (rest.lt(0)) {
    throw new Error(`The structure's fixed and percentage heads come to ₹${used.toFixed(dp)}, more than the gross of ₹${gross.toFixed(dp)}`);
  }
  const balance = lines.find((l) => l.calcType === "BALANCE");
  if (balance) split[COMPONENT_FIELD[balance.component]] = rest;
  return split;
}

/** Monthly gross from the amount HR typed, given Payroll Settings' "salary amount entered as". */
export function monthlyGrossFrom(amount: Decimal.Value, basis: "MONTHLY" | "ANNUAL"): Decimal {
  const v = new Decimal(amount || 0);
  return (basis === "ANNUAL" ? v.div(12) : v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
