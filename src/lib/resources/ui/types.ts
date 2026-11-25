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
  | "lines"
  | "image"
  /** A list of ids picked with checkboxes from the `reference` master. */
  | "multiReference";

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
  /**
   * For type "reference": which master to load options from. `url` loads from
   * another endpoint returning `{ items }` instead of the master; `defaultLabel`
   * preselects the option with that label on a new record. `detailField` adds
   * secondary text to each option (shown and searched), and `searchable`
   * renders a type-to-search box instead of a dropdown.
   */
  reference?: {
    resource: string;
    labelField: string;
    url?: string;
    defaultLabel?: string;
    detailField?: string;
    searchable?: boolean;
  };
  /** Sent even when blank, so clearing it on an edit reaches the server (e.g. unlinking a team member). */
  sendBlank?: boolean;
  /** Shown (and submitted) only when the signed-in user holds all of these permissions. */
  permissions?: string[];
  /**
   * For type "image": the photo is not part of the record's JSON. It is sent
   * to `url` (":id" = the record's id) as multipart "file" after the record is
   * saved, or DELETEd there when removed. `versionField` is the record field
   * that is set when a photo exists; it versions the image URL.
   */
  image?: { url: string; versionField: string; fallbackFrom?: string };
  /** For text fields: fill with a generated value on a new record and offer a "New" button. */
  generate?: "password";
  fullWidth?: boolean;
  defaultValue?: unknown;
  /** For type "lines": the sub-row columns. */
  columns?: LineColumnConfig[];
  /** For type "lines": label of the add-row button, e.g. "Add component". */
  addLabel?: string;
  /** Renders as a picker of the size/colour SKUs of the item chosen in this
   *  reference field (e.g. "outputItemId"). */
  variantOf?: string;
  /** Read-only value worked out from the rest of the form (e.g. a shift's hours from its times); never submitted. */
  compute?: (state: Record<string, unknown>) => unknown;
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
  /** One-line purpose under the heading. */
  description?: string;
  /** Only on the "new" form, not when editing. */
  createOnly?: boolean;
  /** Shown (and submitted) only when the signed-in user holds all of these permissions. */
  permissions?: string[];
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
  /** For type "reference": show the referenced record's label, not its id (a list of ids shows each label). */
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
  /** Permission keys when they are not `<key>.create/edit/delete` (must match the server definition). */
  permissions?: { create: string; edit: string; delete: string };
}
