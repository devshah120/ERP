/**
 * GST state/UT master. Under GST, the place of supply and the CGST+SGST vs
 * IGST decision are driven by the 2-digit **state code**, not by state names.
 * Comparing free-text names is unreliable ("Tamil Nadu" vs "Tamilnadu",
 * "Orissa" vs "Odisha"), so every comparison in this codebase resolves to a
 * code first.
 */

export interface GstState {
  code: string; // 2-digit GST state code
  name: string;
  /**
   * Union territories *without* a legislature levy UTGST instead of SGST.
   * Delhi and Puducherry have legislatures, so they levy SGST like a state.
   */
  utgst?: boolean;
  /** Alternate spellings seen in imported/free-text data. */
  aliases?: string[];
}

export const GST_STATES: GstState[] = [
  { code: "01", name: "Jammu and Kashmir", aliases: ["j&k", "jammu & kashmir"] },
  { code: "02", name: "Himachal Pradesh", aliases: ["hp"] },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh", utgst: true },
  { code: "05", name: "Uttarakhand", aliases: ["uttaranchal"] },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi", aliases: ["new delhi", "nct of delhi"] },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh", aliases: ["up"] },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal", aliases: ["wb"] },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha", aliases: ["orissa"] },
  { code: "22", name: "Chhattisgarh", aliases: ["chattisgarh"] },
  { code: "23", name: "Madhya Pradesh", aliases: ["mp"] },
  { code: "24", name: "Gujarat" },
  {
    code: "26",
    name: "Dadra and Nagar Haveli and Daman and Diu",
    utgst: true,
    aliases: ["dadra and nagar haveli", "daman and diu", "dnhdd"],
  },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep", utgst: true },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu", aliases: ["tamilnadu", "tn"] },
  { code: "34", name: "Puducherry", aliases: ["pondicherry"] },
  { code: "35", name: "Andaman and Nicobar Islands", utgst: true, aliases: ["andaman and nicobar"] },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh", aliases: ["ap"] },
  { code: "38", name: "Ladakh", utgst: true },
  { code: "97", name: "Other Territory" },
];

const BY_CODE = new Map(GST_STATES.map((s) => [s.code, s]));

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[.&]/g, "").replace(/\s+/g, " ");
}

const BY_NAME = new Map<string, GstState>();
for (const state of GST_STATES) {
  BY_NAME.set(normalise(state.name), state);
  for (const alias of state.aliases ?? []) BY_NAME.set(normalise(alias), state);
}

export function findStateByCode(code?: string | null): GstState | undefined {
  if (!code) return undefined;
  return BY_CODE.get(code.trim().padStart(2, "0"));
}

export function findStateByName(name?: string | null): GstState | undefined {
  if (!name) return undefined;
  return BY_NAME.get(normalise(name));
}

/**
 * Resolves a party's GST state. The GSTIN is authoritative when present —
 * its first two characters are the registered state code — because a typed
 * address state can disagree with the registration.
 */
export function resolveGstState(params: { gstin?: string | null; stateName?: string | null }): GstState | undefined {
  const fromGstin = params.gstin?.trim().length === 15 ? findStateByCode(params.gstin.trim().slice(0, 2)) : undefined;
  return fromGstin ?? findStateByName(params.stateName);
}
