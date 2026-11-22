"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/client";

/** Small building blocks shared by the HRMS screens. */

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : v;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function todayKey(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function minutesLabel(m: number): string {
  if (!m) return "—";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h ${mm.toString().padStart(2, "0")}m` : `${mm}m`;
}

export function Kpi({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const body = (
    <>
      <span className="hrKpiLabel">{label}</span>
      <span className="hrKpiValue">{value}</span>
      {sub && <span className="hrKpiSub">{sub}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="hrKpi">
      {body}
    </Link>
  ) : (
    <div className="hrKpi">{body}</div>
  );
}

export function Card({ title, action, children, bodyStyle }: { title: ReactNode; action?: ReactNode; children: ReactNode; bodyStyle?: React.CSSProperties }) {
  return (
    <section className="card">
      <div className="cardHeader">
        <h2 className="cardTitle" style={{ margin: 0 }}>
          {title}
        </h2>
        {action}
      </div>
      <div className="cardBody" style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}

export function AttCode({ code }: { code: string }) {
  if (!code) return <span className="hrMuted">·</span>;
  return (
    <span className="attCode" data-code={code}>
      {code}
    </span>
  );
}

export const ATT_LEGEND: [string, string][] = [
  ["P", "Present"],
  ["A", "Absent"],
  ["HD", "Half day"],
  ["L", "Paid leave"],
  ["LOP", "Unpaid leave"],
  ["H", "Holiday"],
  ["WO", "Weekly off"],
  ["OD", "On duty"],
  ["-", "Not marked (paid)"],
];

export function AttLegend() {
  return (
    <div className="hrLegend">
      {ATT_LEGEND.map(([c, l]) => (
        <span key={c}>
          <AttCode code={c} /> {l}
        </span>
      ))}
    </div>
  );
}

/** Month + year pickers bound to one { year, month } value. */
export function MonthPicker({ year, month, onChange }: { year: number; month: number; onChange: (v: { year: number; month: number }) => void }) {
  const now = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => now - 4 + i);
  return (
    <>
      <select className="select" style={{ width: "auto" }} value={month} onChange={(e) => onChange({ year, month: Number(e.target.value) })} aria-label="Month">
        {MONTH_NAMES.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select className="select" style={{ width: "auto" }} value={year} onChange={(e) => onChange({ year: Number(e.target.value), month })} aria-label="Year">
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </>
  );
}

export interface Option {
  id: string;
  label: string;
}

/** Active employees as select options, "EMP-000001 · Asha Rao". */
export function useEmployeeOptions(): Option[] | null {
  const [opts, setOpts] = useState<Option[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: { id: string; employeeCode: string; name: string; employmentStatus?: string }[] }>("/api/masters/hr-employees?pageSize=200&status=ACTIVE&sortBy=employeeCode&sortDir=asc")
      .then((r) => {
        const current = r.items.filter((e) => !["RESIGNED", "TERMINATED", "RETIRED"].includes(e.employmentStatus ?? ""));
        if (!cancelled) setOpts(current.map((e) => ({ id: e.id, label: `${e.employeeCode} · ${e.name}` })));
      })
      .catch(() => {
        if (!cancelled) setOpts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return opts;
}

export function useMasterOptions(resource: string, label: (r: Record<string, unknown>) => string): Option[] | null {
  const [opts, setOpts] = useState<Option[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: Record<string, unknown>[] }>(`/api/masters/${resource}?pageSize=200&status=ACTIVE`)
      .then((r) => {
        if (!cancelled) setOpts(r.items.map((x) => ({ id: String(x.id), label: label(x) })));
      })
      .catch(() => {
        if (!cancelled) setOpts([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- label is a formatting callback; reload only when the resource changes
  }, [resource]);
  return opts;
}

/** Downloads a server-generated export (xlsx/csv) through a plain link, keeping cookies. */
export function downloadHref(path: string, params: Record<string, string | number | undefined>, format: "xlsx" | "csv") {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  q.set("format", format);
  return `${path}?${q.toString()}`;
}

export const CLAIM_CATEGORY_LABELS: Record<string, string> = {
  TRAVEL: "Travel",
  FOOD: "Food",
  ACCOMMODATION: "Accommodation",
  FUEL: "Fuel",
  PHONE_INTERNET: "Phone & internet",
  MEDICAL: "Medical",
  OFFICE_SUPPLIES: "Office supplies",
  OTHER: "Other",
};
