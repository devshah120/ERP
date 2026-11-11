import { Schema } from "mongoose";
import { defineMasterModel, itemLineSchema } from "./shared/masterSchema";

export const FORMULA_KINDS = ["BOM", "RECIPE"] as const;
export type FormulaKind = (typeof FORMULA_KINDS)[number];

/**
 * What it takes to make something.
 *
 * A bill of materials lists the components of a finished garment (fabric,
 * buttons, labels); a recipe lists the inputs of a process (dyes and
 * chemicals per kg of fabric). Both are "these inputs make that output", so
 * they share one model, split by `kind`, and Material Creation can produce
 * from either.
 */
export const ProductionFormula = defineMasterModel(
  "ProductionFormula",
  {
    kind: { type: String, enum: FORMULA_KINDS, required: true },
    formulaCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    outputItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    outputVariantSku: { type: String, trim: true, uppercase: true },
    /** How many units of the output one run of the components makes. */
    outputQuantity: { type: Number, required: true, min: 0, default: 1 },
    components: { type: [itemLineSchema], default: [] },
    /** Labour, job-work and overheads per run, added to the output's cost. */
    processingCost: { type: Schema.Types.Decimal128, default: "0" },
    instructions: { type: String, trim: true },
  },
  { uniqueField: "formulaCode", indexes: [{ kind: 1 }] }
);
