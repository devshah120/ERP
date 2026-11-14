"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Insight } from "@/lib/analytics/types";
import type { Segment } from "@/lib/analytics/overview";
import { formatCompact, formatCount, formatMoney, formatQuantity } from "@/lib/format/number";
import { Delta } from "@/components/dashboard/Widgets";
import { EmptyState } from "@/components/ui/States";
import { IconAlertCircle, IconArrowRight, IconCheckCircle, IconInfo, IconWarning } from "@/components/icons";

/* ------------------------------------------------------------------ */
/* Card + toggle                                                       */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  kicker,
  actions,
  footnote,
  className = "",
  children,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  actions?: ReactNode;
  footnote?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`plCard ${className}`}>
      <header className="plCardHead">
        <div className="plCardTitles">
          <h2>{title}</h2>
          {kicker && <p>{kicker}</p>}
        </div>
        {actions && <div className="plCardActions">{actions}</div>}
      </header>
      <div className="plCardBody">{children}</div>
      {footnote && <p className="plFoot">{footnote}</p>}
    </section>
  );
}

export function Toggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="plToggle" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Spotlight tile — headline number, change, and a small visual        */
/* ------------------------------------------------------------------ */

export function SpotlightTile({
  icon,
  label,
  value,
  kind = "money",
  previous,
  goodWhen,
  caption,
  href,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  kind?: "money" | "count";
  previous?: string;
  goodWhen?: "up" | "down";
  caption?: ReactNode;
  href?: string;
  children?: ReactNode;
}) {
  const shown = kind === "money" ? `₹${formatCompact(value)}` : formatCount(value);
  const full = kind === "money" ? `₹${formatMoney(value)}` : formatCount(value);
  const body = (
    <>
      <div className="plSpotTop">
        <span className="plSpotIcon" aria-hidden>
          {icon}
        </span>
        <span className="plSpotLabel">{label}</span>
        {href && <IconArrowRight className="plSpotGo" aria-hidden />}
      </div>
      <div className="plSpotValue" title={full}>
        {shown}
      </div>
      <div className="plSpotMeta">
        {previous !== undefined && <Delta current={value} previous={previous} goodWhen={goodWhen} />}
        {caption && <span>{caption}</span>}
      </div>
      {children && <div className="plSpotViz">{children}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="plSpot">
      {body}
    </Link>
  ) : (
    <div className="plSpot">{body}</div>
  );
}

/* ------------------------------------------------------------------ */
/* Meter list — several ratios, each against its own whole             */
/* ------------------------------------------------------------------ */

export type Severity = "ok" | "warn" | "bad" | "none";

const SEVERITY_TEXT: Record<Severity, string> = { ok: "On track", warn: "Keep an eye", bad: "Act now", none: "No data yet" };

export interface MeterSpec {
  key: string;
  label: string;
  /** 0–100, or null when there is nothing to measure yet. */
  percent: number | null;
  severity: Severity;
  note: string;
  href?: string;
}

export function MeterList({ meters }: { meters: MeterSpec[] }) {
  return (
    <ul className="plMeters">
      {meters.map((m) => {
        const pct = m.percent === null ? 0 : Math.max(0, Math.min(100, m.percent));
        const Icon = m.severity === "ok" ? IconCheckCircle : m.severity === "bad" ? IconAlertCircle : m.severity === "warn" ? IconWarning : IconInfo;
        const row = (
          <>
            <div className="plMeterHead">
              <span className="plMeterLabel">{m.label}</span>
              <strong className="plMeterValue">{m.percent === null ? "—" : `${pct.toFixed(pct >= 10 ? 0 : 1)}%`}</strong>
            </div>
            <span
              className={`plMeterTrack sev-${m.severity}`}
              role="meter"
              aria-label={m.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={m.percent === null ? undefined : Number(pct.toFixed(1))}
            >
              <span className="plMeterFill" style={{ width: `${m.percent === null ? 0 : Math.max(2, pct)}%` }} />
            </span>
            <div className="plMeterFoot">
              <span className={`plSev sev-${m.severity}`}>
                <Icon aria-hidden />
                {SEVERITY_TEXT[m.severity]}
              </span>
              <span>{m.note}</span>
            </div>
          </>
        );
        return <li key={m.key}>{m.href ? <Link href={m.href}>{row}</Link> : <div>{row}</div>}</li>;
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Tall segmented bar + list — how one whole splits                    */
/* ------------------------------------------------------------------ */

const MODE_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK: "Bank transfer",
  CHEQUE: "Cheque",
  CREDIT: "On credit",
  MIXED: "Split payment",
  ADJUSTMENT: "Adjustment",
};
/** Colour follows the payment mode, never its rank, so a mode keeps its colour across periods. */
const MODE_SLOT: Record<string, number> = { CASH: 1, UPI: 2, CARD: 3, BANK: 4, CHEQUE: 5, CREDIT: 6 };

export function ModeSplit({ rows }: { rows: { mode: string; amount: string; count: number }[] }) {
  const positive = rows.filter((r) => Number(r.amount) > 0);
  const known = positive.filter((r) => MODE_SLOT[r.mode]);
  const rest = positive.filter((r) => !MODE_SLOT[r.mode]);
  const parts = [
    ...known.map((r) => ({ key: r.mode, label: MODE_LABEL[r.mode] ?? r.mode, amount: Number(r.amount), count: r.count, color: `var(--chart-${MODE_SLOT[r.mode]})`, dark: MODE_SLOT[r.mode] === 4 })),
    ...(rest.length
      ? [{
          key: "OTHER",
          label: rest.length === 1 ? MODE_LABEL[rest[0].mode] ?? rest[0].mode : "Other",
          amount: rest.reduce((a, r) => a + Number(r.amount), 0),
          count: rest.reduce((a, r) => a + r.count, 0),
          color: "var(--chart-other)",
          dark: true,
        }]
      : []),
  ];
  const total = parts.reduce((a, p) => a + p.amount, 0);

  if (total <= 0) return <EmptyState compact title="Nothing recorded for this period" description="Payments show up here as they are recorded." />;

  return (
    <div className="plSplit">
      <div className="plSplitTotal">
        <span>Total</span>
        <strong title={`₹${formatMoney(total)}`}>₹{formatCompact(total)}</strong>
      </div>
      <div className="plSplitBar" role="img" aria-label={parts.map((p) => `${p.label} ${((p.amount / total) * 100).toFixed(0)}%`).join(", ")}>
        {parts.map((p) => {
          const share = (p.amount / total) * 100;
          return (
            <span
              key={p.key}
              className="plSplitSeg"
              style={{ flexGrow: p.amount, background: p.color, color: p.dark ? "var(--text)" : "var(--text-inverse)" }}
              title={`${p.label}: ₹${formatMoney(p.amount)} (${share.toFixed(1)}%)`}
            >
              {share >= 12 ? `${share.toFixed(0)}%` : ""}
            </span>
          );
        })}
      </div>
      <ul className="plSplitList">
        {parts.map((p) => (
          <li key={p.key}>
            <span className="plSwatch" style={{ background: p.color }} aria-hidden />
            <span className="plSplitName">{p.label}</span>
            <span className="plSplitCount">
              {p.count} entr{p.count === 1 ? "y" : "ies"}
            </span>
            <strong>₹{formatMoney(p.amount)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ranked list — top buyers                                            */
/* ------------------------------------------------------------------ */

export function RankList({ rows, total, empty }: { rows: { label: string; value: number; href?: string }[]; total: number; empty: string }) {
  const list = rows.filter((r) => r.value > 0);
  if (list.length === 0) return <EmptyState compact title={empty} />;
  return (
    <ol className="plRank">
      {list.map((r, i) => {
        const share = total > 0 ? (r.value / total) * 100 : 0;
        const name = r.href ? (
          <Link href={r.href} className="plRankName">
            {r.label}
          </Link>
        ) : (
          <span className="plRankName">{r.label}</span>
        );
        return (
          <li key={`${r.label}-${i}`}>
            <span className={`plRankNo ${i < 3 ? "top" : ""}`}>{i + 1}</span>
            <div className="plRankMain">
              <div className="plRankLine">
                {name}
                <strong title={`₹${formatMoney(r.value)}`}>₹{formatCompact(r.value)}</strong>
              </div>
              <div className="plRankBar">
                <span style={{ width: `${Math.max(2, share)}%` }} />
              </div>
              <small>{share.toFixed(1)}% of revenue</small>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Customer mix — RFM segments as plain-language groups                */
/* ------------------------------------------------------------------ */

const SEGMENT_COPY: Record<string, { name: string; help: string }> = {
  champions: { name: "Star customers", help: "Bought recently, often, and big" },
  loyal: { name: "Regulars", help: "Steady buyers you can count on" },
  potential: { name: "Rising", help: "Recent buyers spending more each time" },
  promising: { name: "New & promising", help: "Recent, but small orders so far" },
  needsAttention: { name: "Cooling off", help: "Buying less often than before" },
  atRisk: { name: "Slipping away", help: "Used to buy well, gone quiet" },
  cantLose: { name: "Big spenders gone quiet", help: "High value, worth a call" },
  hibernating: { name: "Dormant", help: "Small and not seen in a while" },
};

export function CustomerMix({ segments }: { segments: { customers: number; items: Segment[] } }) {
  const rows = segments.items.filter((s) => s.customers > 0).sort((a, b) => b.customers - a.customers);
  if (rows.length === 0) return <EmptyState compact title="No customer bought in this period" description="Groups form once invoices are raised." />;
  return (
    <ul className="plMix">
      {rows.map((s) => {
        const copy = SEGMENT_COPY[s.key] ?? { name: s.label, help: "" };
        return (
          <li key={s.key}>
            <div className="plMixText">
              <strong>{copy.name}</strong>
              <small>{copy.help}</small>
            </div>
            <div className="plMixBar" aria-hidden>
              <span style={{ width: `${Math.max(2, Number(s.percent))}%` }} />
            </div>
            <div className="plMixNums">
              <strong>
                {s.customers} <small>({Number(s.percent).toFixed(0)}%)</small>
              </strong>
              <small title={`₹${formatMoney(s.value)}`}>₹{formatCompact(s.value)}</small>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Attention feed — the module insights, as a to-do list               */
/* ------------------------------------------------------------------ */

export function AttentionFeed({ insights }: { insights: Insight[] }) {
  const order = { bad: 0, warn: 1, neutral: 2, good: 3 } as const;
  const list = [...insights].sort((a, b) => order[a.tone] - order[b.tone]);
  if (list.length === 0) {
    return (
      <EmptyState
        compact
        icon={<IconCheckCircle style={{ color: "var(--success-solid)" }} />}
        title="All clear"
        description="Nothing needs your attention right now."
      />
    );
  }
  return (
    <ul className="plFeed">
      {list.map((i) => {
        const Icon = i.tone === "good" ? IconCheckCircle : i.tone === "bad" ? IconAlertCircle : i.tone === "warn" ? IconWarning : IconInfo;
        return (
          <li key={i.key} className={`tone-${i.tone}`}>
            <span className="plFeedIcon" aria-hidden>
              <Icon />
            </span>
            <div>
              <p className="plFeedHead">{i.headline}</p>
              {i.detail && <p className="plFeedDetail">{i.detail}</p>}
              {i.action && (
                <Link href={i.action.href} className="plFeedAction">
                  {i.action.label}
                  <IconArrowRight aria-hidden />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Running low                                                         */
/* ------------------------------------------------------------------ */

export interface LowStockRow {
  itemName?: string;
  itemNameHref?: string;
  variantSku?: string;
  warehouse?: string;
  quantity?: number;
  reorderLevel?: number;
}

export function RunningLow({ rows }: { rows: LowStockRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={<IconCheckCircle style={{ color: "var(--success-solid)" }} />}
        title="Shelves look good"
        description="No item has dropped to its reorder level."
      />
    );
  }
  return (
    <ul className="plLow">
      {rows.map((r, i) => {
        const pct = r.reorderLevel ? Math.min(100, ((r.quantity ?? 0) / r.reorderLevel) * 100) : 0;
        return (
          <li key={`${r.itemName}-${r.variantSku}-${i}`}>
            <div className="plLowText">
              {r.itemNameHref ? (
                <Link href={r.itemNameHref} className="plLowName">
                  {r.itemName}
                </Link>
              ) : (
                <span className="plLowName">{r.itemName}</span>
              )}
              <small>{[r.variantSku && r.variantSku !== "—" ? r.variantSku : null, r.warehouse].filter(Boolean).join(" · ")}</small>
            </div>
            <div className="plLowLevel">
              <span className="plLowTrack" aria-hidden>
                <span style={{ width: `${Math.max(4, pct)}%` }} />
              </span>
              <small>
                <strong>{formatQuantity(r.quantity ?? 0)}</strong> left · reorder at {formatQuantity(r.reorderLevel ?? 0)}
              </small>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
