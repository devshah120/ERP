"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import AccessDenied from "@/components/ui/AccessDenied";
import { Card, MonthPicker, MONTH_NAMES } from "@/components/hr/HrKit";
import { IconDownload } from "@/components/icons";

interface Result {
  rows: number;
  employees: number;
  amounts: number;
  components: string[];
  errors: { row: number; message: string }[];
  committed: boolean;
}

function thisMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Upload a month's variable pay from Excel: check it first, then import. */
export default function ImportVariablePayPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState(thisMonth());
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermission("hr-payroll.process")) return <AccessDenied detail="Importing variable pay needs the payroll processing permission." />;
  const label = `${MONTH_NAMES[period.month - 1]} ${period.year}`;

  async function send(commit: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("year", String(period.year));
      form.set("month", String(period.month));
      form.set("commit", String(commit));
      // FormData upload: plain fetch so the browser sets the multipart boundary.
      const res = await fetch("/api/hr/payroll/variables/import", { method: "POST", body: form, credentials: "include" });
      const body = await res.json();
      if (!body.success) throw new ApiError(body.message ?? "Import failed", body.code ?? "IMPORT_FAILED", body.errors, res.status);
      setResult(body.data);
      if (body.data.committed) toast.success(`Variable pay imported for ${label}`, `${body.data.amounts} amount(s) for ${body.data.employees} employee(s)`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Import variable pay"
        description="Fill in a month's bonus, incentive, overtime and deductions in Excel and upload it. The file is checked first; nothing is saved until you import."
        actions={
          <Link href="/hr/payroll/variables" className="button buttonSecondary">
            Back to variable pay
          </Link>
        }
      />

      <Card title="1. Download the template">
        <p className="hrMuted" style={{ marginTop: 0 }}>
          The template lists everyone on the rolls in the month with one column per pay component and any amounts already entered. Columns are matched by component code; a blank or 0 clears that amount.
        </p>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <MonthPicker year={period.year} month={period.month} onChange={(p) => (setPeriod(p), setResult(null))} />
          <a href={`/api/hr/payroll/variables/template?year=${period.year}&month=${period.month}`} className="button buttonSecondary" download>
            <IconDownload /> Template for {label}
          </a>
        </div>
      </Card>

      <Card title="2. Upload and check">
        <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
            }}
            aria-label="Variable pay file"
          />
          <button type="button" className="button buttonSecondary" onClick={() => send(false)} disabled={!file || busy}>
            {busy && <span className="spinner" />} Check file
          </button>
          <button type="button" className="button buttonPrimary" onClick={() => send(true)} disabled={!file || busy || !result || result.errors.length > 0 || result.committed}>
            Import into {label}
          </button>
        </div>

        {error && (
          <div className="banner bannerError">
            <span>{error}</span>
          </div>
        )}
        {result && result.errors.length === 0 && (
          <div className={`banner ${result.committed ? "bannerSuccess" : "bannerInfo"}`}>
            <span>
              {result.committed ? "Imported: " : "Ready to import: "}
              {result.amounts} amount(s) for {result.employees} employee(s) across {result.components.join(", ") || "no components"}.
              {result.committed && (
                <>
                  {" "}
                  <Link href="/hr/payroll/variables" className="textLink">
                    Review on the grid
                  </Link>
                </>
              )}
            </span>
          </div>
        )}
        {result && result.errors.length > 0 && (
          <>
            <div className="banner bannerError" style={{ marginBottom: "0.5rem" }}>
              <span>{result.errors.length} problem(s) to fix before importing. Nothing has been saved.</span>
            </div>
            <div className="tableWrap" style={{ maxHeight: "20rem", overflow: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="numCell">Row</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i}>
                      <td className="numCell">{e.row}</td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
