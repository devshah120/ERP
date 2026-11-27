import mongoose from "mongoose";
import { SalaryStructure, PtSlab } from "@/models/hr";
import { recordAudit } from "@/lib/services/auditService";
import { toDecimal128 } from "@/lib/documents/decimal128";
import Decimal from "decimal.js";
import type { AuthContext } from "@/lib/auth/context";

const dec = (v: string) => toDecimal128(new Decimal(v));

/*
 * Demo payroll set-up, so HR can see a working example before entering their
 * own: one salary structure and a state's PT slabs. Safe to run twice: what
 * already exists is left alone. The PT slabs are created INACTIVE, because an
 * active slab switches every employee's PT from their fixed amount to the
 * slabs; HR activates them after checking the rates.
 */

export const DEMO_STRUCTURE_CODE = "DEMO-STAFF";
const DEMO_PT_STATE = "Gujarat (demo)";

export async function createPayrollDemo(ctx: AuthContext) {
  const created: string[] = [];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      created.length = 0;
      const base = { businessId: ctx.businessId, createdBy: ctx.userId, updatedBy: ctx.userId };

      const hasStructure = await SalaryStructure.exists({ businessId: ctx.businessId, code: DEMO_STRUCTURE_CODE }).session(session);
      if (!hasStructure) {
        await SalaryStructure.create(
          [
            {
              ...base,
              code: DEMO_STRUCTURE_CODE,
              name: "Standard Staff (demo)",
              description: "Demo: basic 50% of gross, HRA 40% of basic, conveyance ₹1,600, special allowance takes the rest. Edit or copy it for your own structures.",
              roundingDecimals: 0,
              lines: [
                { component: "BASIC", calcType: "PERCENT_OF_GROSS", value: 50 },
                { component: "HRA", calcType: "PERCENT_OF_BASIC", value: 40 },
                { component: "CONV", calcType: "FIXED", value: 1600 },
                { component: "SPECIAL", calcType: "BALANCE", value: 0 },
              ],
            },
          ],
          { session }
        );
        created.push("salary structure “Standard Staff (demo)”");
      }

      const hasSlabs = await PtSlab.exists({ businessId: ctx.businessId, state: DEMO_PT_STATE, deletedAt: null }).session(session);
      if (!hasSlabs) {
        const note = "Demo slab: check your state's current rates, then set it Active.";
        await PtSlab.create(
          [
            { ...base, state: DEMO_PT_STATE, minGross: dec("0"), maxGross: dec("11999.99"), amount: dec("0"), februaryAmount: dec("0"), description: note, status: "INACTIVE" },
            { ...base, state: DEMO_PT_STATE, minGross: dec("12000"), maxGross: dec("0"), amount: dec("200"), februaryAmount: dec("0"), description: note, status: "INACTIVE" },
          ],
          { session, ordered: true }
        );
        created.push("2 PT slabs for Gujarat (inactive)");
      }
    });
  } finally {
    await session.endSession();
  }

  if (created.length > 0) {
    await recordAudit({
      businessId: ctx.businessId,
      userId: ctx.userId,
      action: "CREATE",
      module: "hr.payroll-setup",
      documentType: "Payroll demo data",
      newValue: { created },
    });
  }
  return { created };
}
