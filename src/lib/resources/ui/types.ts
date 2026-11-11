export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "email"
  | "tel"
  | "select"
  | "reference"
  | "checkbox"
  | "variants"
  | "date"
  | "lines";

/** One column of a "lines" field — a small inline table of sub-rows. */
export interface LineColumnConfig {
  name: string;
  label: string;
  type: "text" | "number" | "money" | "reference" | "variant";
  /** For "reference": which master to load options from. */
  reference?: { resource: string; labelField: string };
  /** For "variant": the reference column whose item's SKUs to offer. */
  itemColumn?: string;
  required?: boolean;
  placeholder?: string;
  width?: string;
  defaultValue?: unknown;
}

/**
 * Where a document field appears on the entry form. Tabs exist only where
 * there is real content behind them — an empty tab is worse than no tab.
 */
export type DocumentFormTab = "addition" | "partner" | "other" | "additional";

export interface FieldConfig {
  /** Supports dot paths for nested values, e.g. "billingAddress.city". */
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** For type "reference": which master to load options from. */
  reference?: { resource: string; labelField: string };
  fullWidth?: boolean;
  defaultValue?: unknown;
  /** For type "lines": the sub-row columns. */
  columns?: LineColumnConfig[];
  /** For type "lines": label of the add-row button, e.g. "Add component". */
  addLabel?: string;
  /** Renders as a picker of the size/colour SKUs of the item chosen in this
   *  reference field (e.g. "outputItemId"). */
  variantOf?: string;
  /** Only show (and submit) this field while another field has one of these values. */
  showWhen?: { field: string; values: string[] };

  /** Document forms only — promotes the field into the top header grid
   *  alongside date, number and party, instead of hiding it in a tab. */
  header?: boolean;
  /** Document forms only — which tab the field sits under. Defaults to
   *  "additional". */
  tab?: DocumentFormTab;
}

export interface SectionConfig {
  label: string;
  fields: FieldConfig[];
}

export interface ColumnConfig {
  /** Dot path into the record, e.g. "billingAddress.city". */
  key: string;
  label: string;
  /** Query-param name enabling the inline column filter input. */
  filterParam?: string;
  /** Field name sent as sortBy when the header is clicked. */
  sortField?: string;
  type?: "text" | "badge" | "money" | "number" | "date" | "count" | "label" | "reference" | "yesno";
  /** For type "label": stored value → display text, e.g. PERCENT → "Percent". */
  labels?: Record<string, string>;
  /** For type "reference": show the referenced record's label, not its id. */
  reference?: { resource: string; labelField: string };
}

export interface ResourceUi {
  key: string;
  title: string;
  singular: string;
  apiPath: string;
  basePath: string;
  columns: ColumnConfig[];
  sections: SectionConfig[];
  /** Field used as the edit-page title; defaults to "name". */
  titleField?: string;
  /** New records start from these workspace settings: section + form field → setting key. */
  settingsDefaults?: { section: string; map: Record<string, string> };
}
