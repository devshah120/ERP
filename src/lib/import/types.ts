export interface ImportFieldDef {
  /** Column header used in the template and expected in the upload. */
  header: string;
  /** Path on the payload sent to the create API, e.g. "billingAddress.city". */
  path: string;
  required?: boolean;
  /** Free-text guidance written into the template's instructions sheet. */
  hint?: string;
  /** Example value for the sample row. */
  example?: string;
  type?: "text" | "number" | "money" | "boolean";
  /**
   * Resolve a human-readable value (e.g. a category *name*) to the id the API
   * expects. Declared per field so imports can reference masters by name
   * rather than forcing users to paste ObjectIds.
   */
  lookup?: { resource: string; matchField: string; label: string };
}

export interface ImportDefinition {
  /** Master resource key, e.g. "vendors". */
  resource: string;
  title: string;
  fields: ImportFieldDef[];
  /** Field used to detect rows that already exist. */
  duplicateKey?: { path: string; header: string };
}

export interface ImportRowError {
  /** 1-based row number as it appears in the user's file (header = row 1). */
  row: number;
  column?: string;
  message: string;
}

export interface ImportPreviewRow {
  row: number;
  values: Record<string, unknown>;
  errors: ImportRowError[];
  /** True when an existing record already has this duplicate key. */
  duplicate?: boolean;
}

export interface ImportPreviewResult {
  resource: string;
  title: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  rows: ImportPreviewRow[];
  errors: ImportRowError[];
  /** Headers the file actually contained, for a mismatch hint. */
  detectedHeaders: string[];
  missingHeaders: string[];
}

export interface ImportCommitResult {
  resource: string;
  imported: number;
  skippedDuplicates: number;
}
