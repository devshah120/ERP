"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { notifyHeld } from "@/lib/approvals/clientHelpers";
import { useAuth } from "@/app/(app)/AuthProvider";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { Card, MonthPicker, MONTH_NAMES, useEmployeeOptions, useMasterOptions } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import Select from "@/components/ui/Select";

export type ArrearTab = "increment" | "day" | "da";

interface Arrear {
  id: string;
  kind: "INCREMENT" | "DAY" | "DA";
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  from: { year: number; month: number };
  to: { year: number; month: number };
  days: number | null;
  percent: number | null;
  amount: string;
  breakdown: { code: string; label: string; amount: string }[];
  reason: string;
  status: string;
  paidIn: { id: string; runNumber: string } | null;
}

interface DaPreview {
  committed: boolean;
  total: string;
  rows: { employeeId: string; name: string; code: string; months: number; basic: string; amount: string; skipped: boolean }[];
}

const KIND: Record<ArrearTab, "INCREMENT" | "DAY" | "DA"> = { increment: "INCREMENT", day: "DAY", da: "DA" };
const TITLES: Record<ArrearTab, { title: string; description: string }> = {
  increment: {
    title: "Increment arrears",
    description:
      "Created automatically when a salary increase is backdated into months whose payroll is already approved: the new rate minus what was paid, month by month, for the same paid days. Paid with the next payroll.",
  },
  day: {
    title: "Day arrears",
    description: "Pay back loss-of-pay days of a month whose payroll is already approved (e.g. leave or attendance corrected later), at that month's daily rate. Paid with the next payroll.",
  },
  da: {
    title: "DA arrears",
    description: "Apply a dearness allowance revision retrospectively: a percentage of the basic actually paid in each approved month of a range. Preview, then add to the next payroll.",
  },
};

const monthLabel = (p: { year: number; month: number }) => `${MONTH_NAMES[p.month - 1].slice(0, 3)} ${p.year}`;

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Increment, day and DA arrears: the list for one kind, plus the form to add day or DA arrears. */
export default function Arrears({ tab }: { tab: ArrearTab }) {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<{ items: Arrear[]; pendingTotal: string; pendingCount: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState("");
  const [cancelling, setCancelling] = useState<Arrear | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const canProcess = hasPermission("hr-payroll.process");

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = new URLSearchParams({ kind: KIND[tab] });
      if (status) p.set("status", status);
      setData(await apiFetch(`/api/hr/payroll/arrears?${p.toString()}`));
    } catch (err) {
      setError(err);
    }
  }, [tab, status]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    setCancelError(null);
    try {
      await apiFetch(`/api/hr/payroll/arrears/${cancelling.id}`, { method: "DELETE" });
      toast.success("Arrear cancelled");
      setCancelling(null);
      load();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;
  const t = TITLES[tab];

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          tab === "increment" ? (
            <Link href="/hr/employees" className="button buttonSecondary">
              Record a revision
            </Link>
          ) : undefined
        }
      />

      {tab === "increment" && (
        <div className="banner bannerInfo" style={{ marginBottom: "0.75rem" }}>
          <span>To create increment arrears, open the employee&apos;s profile → History → Record change → Salary revision, with a date inside an approved month.</span>
        </div>
      )}
      {tab === "day" && canProcess && <DayArrearForm onDone={load} />}
      {tab === "da" && canProcess && <DaArrearForm onDone={load} />}

      <div className="toolbar" style={{ marginTop: "0.75rem" }}>
        <Select className="select" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Status: All</option>
          <option value="PENDING">Pending (next payroll)</option>
          <option value="INCLUDED">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
        {data && data.pendingCount > 0 && (
          <span className="hrMuted">
            {data.pendingCount} pending · {formatMoney(data.pendingTotal)}
          </span>
        )}
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>For</th>
              <th>Detail</th>
              <th className="numCell">Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!data && !error && <SkeletonRows columns={6} rows={4} />}
            {error !== null && (
              <tr>
                <td colSpan={6}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load arrears."} onRetry={load} />
                </td>
              </tr>
            )}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState title={`No ${t.title.toLowerCase()} yet`} />
                </td>
              </tr>
            )}
            {data?.items.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link href={`/hr/employees/${a.employeeId}`} className="cellLink">
                    {a.employeeName}
                  </Link>
                  <div className="hrMuted">{a.employeeCode}</div>
                </td>
                <td>
                  {monthLabel(a.from)}
                  {a.from.year !== a.to.year || a.from.month !== a.to.month ? ` – ${monthLabel(a.to)}` : ""}
                </td>
                <td style={{ maxWidth: "20rem" }}>
                  {a.kind === "DAY" && <div>{a.days} day(s) paid back</div>}
                  {a.kind === "DA" && <div>DA {a.percent}% of basic</div>}
                  {a.kind === "INCREMENT" && <div className="hrMuted">{a.breakdown.map((b) => `${b.label} ${formatMoney(b.amount)}`).join(" · ")}</div>}
                  {a.reason && <div className="hrMuted">{a.reason}</div>}
                </td>
                <td className="numCell">
                  <strong>{formatMoney(a.amount)}</strong>
                </td>
                <td>
                  <StatusBadge status={a.status === "INCLUDED" ? "PAID" : a.status} />
                  {a.paidIn && (
                    <div className="hrMuted">
                      in{" "}
                      <Link href={`/hr/payroll/${a.paidIn.id}`} className="textLink">
                        {a.paidIn.runNumber}
                      </Link>
                    </div>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  {canProcess && a.status === "PENDING" && a.kind !== "INCREMENT" && (
                    <button type="button" className="button buttonGhost buttonSm" onClick={() => (setCancelError(null), setCancelling(a))}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cancelling && (
        <ConfirmDialog
          title="Cancel this arrear?"
          message={`${cancelling.employeeName}: ${formatMoney(cancelling.amount)} will not be paid.`}
          confirmLabel="Cancel arrear"
          cancelLabel="Back"
          busy={busy}
          error={cancelError}
          onConfirm={cancel}
          onCancel={() => setCancelling(null)}
        />
      )}
    </>
  );
}

function DayArrearForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const employees = useEmployeeOptions();
  const [period, setPeriod] = useState(lastMonth());
  const [form, setForm] = useState({ employeeId: "", days: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ amount: string }>("/api/hr/payroll/arrears", { method: "POST", body: JSON.stringify({ kind: "DAY", ...period, ...form }) });
      if (!notifyHeld(toast, r)) toast.success("Day arrear added", `${formatMoney(r.amount)} in the next payroll`);
      setForm({ employeeId: "", days: "", reason: "" });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add a day arrear">
      {error && (
        <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
          <span>{error}</span>
        </div>
      )}
      <div className="formGrid">
        <div className="field">
          <label htmlFor="da-emp">Employee</label>
          <Select id="da-emp" className="select" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
            <option value="">— Choose —</option>
            {employees?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label>Month (approved payroll)</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <MonthPicker year={period.year} month={period.month} onChange={setPeriod} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="da-days">Loss-of-pay days to pay back</label>
          <input id="da-days" className="input" inputMode="decimal" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} placeholder="e.g. 2 or 1.5" />
        </div>
        <div className="field">
          <label htmlFor="da-reason">Reason</label>
          <input id="da-reason" className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Leave approved late" />
        </div>
      </div>
      <div style={{ marginTop: "0.75rem" }}>
        <button type="button" className="button buttonPrimary" onClick={submit} disabled={busy || !form.employeeId || !form.days || form.reason.trim().length < 3}>
          {busy && <span className="spinner" />} Add day arrear
        </button>
      </div>
    </Card>
  );
}

function DaArrearForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const departments = useMasterOptions("hr-departments", (r) => String(r.name));
  const [from, setFrom] = useState(lastMonth());
  const [to, setTo] = useState(lastMonth());
  const [form, setForm] = useState({ percent: "", departmentId: "", reason: "" });
  const [preview, setPreview] = useState<DaPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(commit: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<DaPreview>("/api/hr/payroll/arrears", {
        method: "POST",
        body: JSON.stringify({ kind: "DA", ...form, fromYear: from.year, fromMonth: from.month, toYear: to.year, toMonth: to.month, commit }),
      });
      if (commit && notifyHeld(toast, r)) {
        setPreview(null);
        onDone();
      } else if (commit) {
        toast.success("DA arrears added", `${formatMoney(r.total)} in the next payroll`);
        setPreview(null);
        onDone();
      } else {
        setPreview(r);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const ready = Number(form.percent) > 0 && form.reason.trim().length >= 3;
  return (
    <Card title="Apply a DA revision retrospectively">
      {error && (
        <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
          <span>{error}</span>
        </div>
      )}
      <div className="formGrid">
        <div className="field">
          <label htmlFor="dar-pct">DA increase (% of basic)</label>
          <input id="dar-pct" className="input" inputMode="decimal" value={form.percent} onChange={(e) => (setForm({ ...form, percent: e.target.value }), setPreview(null))} placeholder="e.g. 4" />
        </div>
        <div className="field">
          <label htmlFor="dar-dept">Employees</label>
          <Select id="dar-dept" className="select" value={form.departmentId} onChange={(e) => (setForm({ ...form, departmentId: e.target.value }), setPreview(null))}>
            <option value="">Everyone</option>
            {departments?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label>From month</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <MonthPicker year={from.year} month={from.month} onChange={(p) => (setFrom(p), setPreview(null))} />
          </div>
        </div>
        <div className="field">
          <label>To month</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <MonthPicker year={to.year} month={to.month} onChange={(p) => (setTo(p), setPreview(null))} />
          </div>
        </div>
        <div className="field fieldSpanFull">
          <label htmlFor="dar-reason">Reason / notification</label>
          <input id="dar-reason" className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. DA revised from 1 July 2026" />
        </div>
      </div>
      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
        <button type="button" className="button buttonSecondary" onClick={() => send(false)} disabled={busy || !ready}>
          {busy && !preview && <span className="spinner" />} Preview
        </button>
        <button type="button" className="button buttonPrimary" onClick={() => send(true)} disabled={busy || !preview || preview.rows.every((r) => r.skipped)}>
          Add {preview ? formatMoney(preview.total) : ""} to the next payroll
        </button>
      </div>
      {preview && (
        <div className="tableWrap" style={{ marginTop: "0.75rem", maxHeight: "18rem", overflow: "auto" }}>
          {preview.rows.length === 0 ? (
            <EmptyState compact title="Nothing to pay" description="No approved payslips with basic pay in that range." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="numCell">Months</th>
                  <th className="numCell">Basic paid</th>
                  <th className="numCell">Arrear</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.employeeId} style={r.skipped ? { opacity: 0.55 } : undefined}>
                    <td>
                      {r.name}
                      <div className="hrMuted">
                        {r.code}
                        {r.skipped ? " · already has DA arrears for these months" : ""}
                      </div>
                    </td>
                    <td className="numCell">{r.months}</td>
                    <td className="numCell">{formatMoney(r.basic)}</td>
                    <td className="numCell">
                      <strong>{formatMoney(r.amount)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
