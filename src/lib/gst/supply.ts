import { resolveGstState, findStateByName, type GstState } from "./states";

export type SupplyType = "INTRA_STATE" | "INTER_STATE";

export interface SupplyDetermination {
  supplyType: SupplyType;
  /** Convenience flag retained for the tax-splitting maths. */
  intraState: boolean;
  /** State code + name printed on the invoice as "Place of Supply". */
  placeOfSupplyCode?: string;
  placeOfSupplyName?: string;
  /** True when the place of supply is a UT without a legislature, where the
   * state half of the tax is UTGST rather than SGST. */
  isUnionTerritory: boolean;
  /** Set when the supply type had to be assumed, so the UI can warn. */
  warning?: string;
}

export interface PartyPlaceInput {
  gstin?: string | null;
  /** Destination of the goods — the shipping state where available. */
  shippingState?: string | null;
  /** Fallback when there is no separate shipping address. */
  billingState?: string | null;
}

/**
 * Determines the GST supply type for a document.
 *
 * Place of supply for goods is where the goods are *delivered*, so the
 * shipping state is used in preference to the billing state — a Gujarat
 * head office shipping to its Maharashtra warehouse is an inter-state
 * supply even though the bill-to address is local.
 *
 * The GSTIN, when present, is authoritative for the party's registered
 * state; a typed address can disagree with the registration.
 */
export function determineSupply(seller: PartyPlaceInput, buyer: PartyPlaceInput): SupplyDetermination {
  const sellerState = resolveGstState({
    gstin: seller.gstin,
    stateName: seller.billingState ?? seller.shippingState,
  });

  // For the buyer the delivery destination wins; fall back to the registered
  // state from the GSTIN, then the billing address.
  const destinationByName = findStateByName(buyer.shippingState ?? buyer.billingState);
  const buyerState: GstState | undefined =
    destinationByName ?? resolveGstState({ gstin: buyer.gstin, stateName: buyer.billingState });

  if (!sellerState || !buyerState) {
    // Never silently guess a tax treatment: default to intra-state (the more
    // common case) but surface that it was assumed so it can be corrected.
    return {
      supplyType: "INTRA_STATE",
      intraState: true,
      placeOfSupplyCode: buyerState?.code,
      placeOfSupplyName: buyerState?.name,
      isUnionTerritory: buyerState?.utgst ?? false,
      warning: !sellerState
        ? "Your business state could not be matched to a GST state — tax was treated as intra-state (CGST + SGST). Set a valid state or GSTIN in Settings."
        : `"${buyer.shippingState ?? buyer.billingState ?? "unknown"}" could not be matched to a GST state — tax was treated as intra-state (CGST + SGST).`,
    };
  }

  const intraState = sellerState.code === buyerState.code;

  return {
    supplyType: intraState ? "INTRA_STATE" : "INTER_STATE",
    intraState,
    placeOfSupplyCode: buyerState.code,
    placeOfSupplyName: buyerState.name,
    isUnionTerritory: buyerState.utgst ?? false,
  };
}

/** Label for the state half of an intra-state tax: SGST, or UTGST in a UT. */
export function stateTaxLabel(isUnionTerritory: boolean): string {
  return isUnionTerritory ? "UTGST" : "SGST";
}
