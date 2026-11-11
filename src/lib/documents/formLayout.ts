import type { DocumentFormTab, FieldConfig } from "@/lib/resources/ui/types";

/** Tab keys in the order they appear on the form. */
export type FormTabKey = "items" | DocumentFormTab;

export interface FormTab {
  key: FormTabKey;
  label: string;
}

const ALL_TABS: FormTab[] = [
  { key: "items", label: "Item Details" },
  { key: "addition", label: "Other Addition/Deduction" },
  { key: "partner", label: "Partner Details" },
  { key: "other", label: "Other Details" },
  { key: "additional", label: "Additional Details" },
];

export interface DocumentFormLayout {
  /** Fields promoted into the top grid beside date, number and party. */
  header: FieldConfig[];
  /** Fields grouped by the tab they belong to. */
  tabs: Record<DocumentFormTab, FieldConfig[]>;
  /** Tabs actually worth rendering, in order. */
  visibleTabs: FormTab[];
}

/**
 * Decides where each field on a document form goes.
 *
 * Kept as a pure function rather than inline JSX so the placement rules for
 * all eleven document types can be tested directly — the form itself renders
 * only inside the authenticated shell, where its markup is not reachable
 * from a plain HTTP request.
 *
 * Tabs are shown only when they hold something. "Item Details" is always
 * present, and "Other Addition/Deduction" and "Other Details" always have
 * built-in content (shipping/round-off and notes respectively), so they are
 * always shown; the rest appear only if the document type configured fields
 * for them. An empty tab is worse than no tab.
 */
export function buildFormLayout(extraFields: FieldConfig[]): DocumentFormLayout {
  const header: FieldConfig[] = [];
  const tabs: Record<DocumentFormTab, FieldConfig[]> = {
    addition: [],
    partner: [],
    other: [],
    additional: [],
  };

  for (const field of extraFields) {
    if (field.header) {
      header.push(field);
      continue;
    }
    tabs[field.tab ?? "additional"].push(field);
  }

  const alwaysShown = new Set<FormTabKey>(["items", "addition", "other"]);
  const visibleTabs = ALL_TABS.filter(
    (t) => alwaysShown.has(t.key) || tabs[t.key as DocumentFormTab].length > 0
  );

  return { header, tabs, visibleTabs };
}
