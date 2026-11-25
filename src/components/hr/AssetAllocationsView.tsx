"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import Modal from "@/components/ui/Modal";
import SearchSelect from "@/components/resource/SearchSelect";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import AccessDenied, { isForbidden } from "@/components/ui/AccessDenied";
import { fmtDate, todayKey, useEmployeeOptions, apiErrorText } from "@/components/hr/HrKit";
import { formatMoney } from "@/lib/format/number";
import { IconPlus, IconRefresh } from "@/components/icons";
import Select from "@/components/ui/Select";

interface Row {
  id: string;
  allocationNumber: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  category: string;
  serialNumber: string;
  value: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  allocatedOn: string;
  expectedReturnDate: string | null;
  conditionAtIssue: string;
  issueNotes: string;
  status: "ALLOCATED" | "RETURNED";
  returnedOn: string | null;
  outcome: string | null;
  conditionAtReturn: string | null;
  recoveryAmount: string;
  returnNotes: string;
  daysHeld: number;
  overdue: boolean;
}

interface AvailableAsset {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  serialNumber: string;
  condition: string;
}

const CONDITIONS = [
  { value: "NEW", label: "New" },
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
  { value: "DAMAGED", label: "Damaged" },
];
const CONDITION_LABEL: Record<string, string> = Object.fromEntries(CONDITIONS.map((c) => [c.value, c.label]));
const OUTCOME_LABEL: Record<string, string> = { RETURNED: "Returned", DAMAGED: "Returned damaged (sent for repair)", LOST: "Lost" };

type Mode = "allocate" | "return";

const TEXT = {
  allocate: {
    title: "Asset allocation",
    description: "Give laptops, phones, ID cards and other company assets to employees, and see who holds what.",
    tabs: [
      { value: "ALLOCATED", label: "With employees" },
      { value: "", label: "All allocations" },
    ],
  },
  return: {
    title: "Return assets",
    description: "Take assets back from employees, or record them damaged or lost with any amount to recover.",
    tabs: [
      { value: "ALLOCATED", label: "To be returned" },
      { value: "RETURNED", label: "Returned" },
    ],
  },
} as const;

/** Asset Allocation and Return Assets: the same allocations, one screen to hand assets out and one to take them back. */
export default function AssetAllocationsView({ mode }: { mode: Mode }) {
  const t = TEXT[mode];
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canEdit = hasPermission("hr-assets.edit");
  const [tab, setTab] = useState<string>(t.tabs[0].value);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<{ items: Row[]; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [allocating, setAllocating] = useState(false);
  const [assets, setAssets] = useState<AvailableAsset[] | null>(null);
  const employees = useEmployeeOptions();
  const [alloc, setAlloc] = useState({ assetId: "", employeeId: "", allocatedOn: todayKey(), expectedReturnDate: "", condition: "GOOD", notes: "" });

  const [returning, setReturning] = useState<Row | null>(null);
  const [ret, setRet] = useState({ returnedOn: todayKey(), outcome: "RETURNED", condition: "GOOD", recoveryAmount: "", notes: "" });

  useEffect(() => {
    const h = setTimeout(() => {
      setApplied(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status: tab });
      if (applied) p.set("query", applied);
      setResult(await apiFetch(`/api/hr/assets/allocations?${p.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, tab, applied]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function openAllocate() {
    setDialogError(null);
    setAlloc({ assetId: "", employeeId: "", allocatedOn: todayKey(), expectedReturnDate: "", condition: "GOOD", notes: "" });
    setAssets(null);
    setAllocating(true);
    try {
      setAssets((await apiFetch<{ items: AvailableAsset[] }>("/api/hr/assets/available")).items);
    } catch (err) {
      setAssets([]);
      setDialogError(apiErrorText(err, "Could not load the available assets"));
    }
  }

  useShortcutScope({ onNew: mode === "allocate" && canEdit ? () => void openAllocate() : undefined, onRefresh: load });

  async function allocate() {
    setBusy(true);
    setDialogError(null);
    try {
      const r = await apiFetch<{ allocationNumber: string }>("/api/hr/assets/allocations", { method: "POST", body: JSON.stringify(alloc) });
      const a = assets?.find((x) => x.id === alloc.assetId);
      const e = employees?.find((x) => x.id === alloc.employeeId);
      toast.success(`${a?.assetTag ?? "Asset"} given to ${e?.label.split(" · ").pop() ?? "the employee"}`, r.allocationNumber);
      setAllocating(false);
      load();
    } catch (err) {
      setDialogError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  function openReturn(r: Row) {
    setDialogError(null);
    setRet({ returnedOn: todayKey(), outcome: "RETURNED", condition: r.conditionAtIssue || "GOOD", recoveryAmount: "", notes: "" });
    setReturning(r);
  }

  async function submitReturn() {
    if (!returning) return;
    setBusy(true);
    setDialogError(null);
    try {
      const body = {
        returnedOn: ret.returnedOn,
        outcome: ret.outcome,
        ...(ret.outcome === "LOST" ? {} : { condition: ret.condition }),
        recoveryAmount: ret.outcome === "RETURNED" || !ret.recoveryAmount ? "0" : ret.recoveryAmount,
        notes: ret.notes,
      };
      await apiFetch(`/api/hr/assets/allocations/${returning.id}/return`, { method: "POST", body: JSON.stringify(body) });
      toast.success(`${returning.assetTag} ${ret.outcome === "LOST" ? "recorded as lost" : "returned"}`, ret.outcome === "DAMAGED" ? "Marked under repair in the asset register." : undefined);
      setReturning(null);
      load();
    } catch (err) {
      setDialogError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (isForbidden(error)) return <AccessDenied detail={(error as Error).message} />;

  const showReturned = tab !== "ALLOCATED";
  const actionCol = mode === "return" && tab === "ALLOCATED" && canEdit;
  const cols = 6 + (showReturned ? 1 : 0) + (actionCol ? 1 : 0);
  const assetOptions = (assets ?? []).map((a) => ({ value: a.id, label: `${a.assetTag} · ${a.name}`, detail: [a.category, a.serialNumber && `S/N ${a.serialNumber}`].filter(Boolean).join(" · ") }));

  return (
    <>
      <PageHeader
        title={t.title}
        count={result?.total ?? null}
        description={t.description}
        actions={
          <>
            <Link href="/hr-assets" className="button buttonSecondary">
              Asset register
            </Link>
            {mode === "allocate" && canEdit && (
              <button type="button" className="button buttonPrimary" onClick={openAllocate}>
                <IconPlus /> Allocate asset
              </button>
            )}
          </>
        }
      />

      <div className="tabBar" role="tablist" aria-label="Allocations">
        {t.tabs.map((x) => (
          <button key={x.value || "all"} type="button" role="tab" className="tabBarItem" aria-selected={tab === x.value} onClick={() => (setTab(x.value), setPage(1))}>
            {x.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search asset tag, name, serial no. or employee…" width="22rem" />
        <div className="toolbarRight">
          <button type="button" className="button buttonSecondary buttonIcon" onClick={load} disabled={loading} aria-label="Refresh">
            {loading ? <span className="spinner" /> : <IconRefresh />}
          </button>
        </div>
      </div>

      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Employee</th>
              <th>Allocated</th>
              <th>Expected back</th>
              <th className="numCell">Days held</th>
              <th>Condition given</th>
              {showReturned && <th>Returned</th>}
              {actionCol && <th />}
            </tr>
          </thead>
          <tbody>
            {!result && !error && <SkeletonRows columns={cols} rows={5} />}
            {error !== null && (
              <tr>
                <td colSpan={cols}>
                  <ErrorState message={error instanceof ApiError ? error.message : "Could not load allocations."} onRetry={load} />
                </td>
              </tr>
            )}
            {result && result.items.length === 0 && (
              <tr>
                <td colSpan={cols}>
                  <EmptyState
                    variant={applied ? "search" : undefined}
                    title={tab === "ALLOCATED" ? "No assets with employees" : "Nothing here yet"}
                    description={mode === "allocate" && tab === "ALLOCATED" ? "Add assets to the asset register, then allocate them here." : undefined}
                  />
                </td>
              </tr>
            )}
            {result?.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong className="cellMono">{r.assetTag}</strong> {r.assetName}
                  <div className="hrMuted">
                    {[r.category, r.serialNumber && `S/N ${r.serialNumber}`, r.allocationNumber].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td>
                  <Link href={`/hr/employees/${r.employeeId}`} className="cellLink">
                    {r.employeeName}
                  </Link>
                  <div className="hrMuted">{[r.employeeCode, r.department].filter(Boolean).join(" · ")}</div>
                </td>
                <td>{fmtDate(r.allocatedOn)}</td>
                <td>
                  {r.expectedReturnDate ? fmtDate(r.expectedReturnDate) : <span className="cellMuted">—</span>}
                  {r.overdue && (
                    <div>
                      <span className="badge badgeDanger">Overdue</span>
                    </div>
                  )}
                </td>
                <td className="numCell">{r.daysHeld}</td>
                <td>
                  {CONDITION_LABEL[r.conditionAtIssue] ?? r.conditionAtIssue}
                  {r.issueNotes && <div className="hrMuted">{r.issueNotes}</div>}
                </td>
                {showReturned && (
                  <td>
                    {r.status === "RETURNED" ? (
                      <>
                        {fmtDate(r.returnedOn)} · {OUTCOME_LABEL[r.outcome ?? ""] ?? r.outcome}
                        <div className="hrMuted">
                          {[r.conditionAtReturn && `Condition ${CONDITION_LABEL[r.conditionAtReturn] ?? r.conditionAtReturn}`, r.recoveryAmount !== "0.00" && `Recover ${formatMoney(r.recoveryAmount)}`, r.returnNotes]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </>
                    ) : (
                      <span className="badge badgeWarning">With employee</span>
                    )}
                  </td>
                )}
                {actionCol && (
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="button buttonSecondary buttonSm" onClick={() => openReturn(r)}>
                      Return
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.total > 0 && <Pagination page={page} pageSize={pageSize} total={result.total} onPage={setPage} onPageSize={setPageSize} />}
      </div>

      {allocating && (
        <Modal
          title="Allocate asset"
          subtitle="Only assets that are available (not with anyone, under repair, lost or retired) can be given out."
          onClose={() => setAllocating(false)}
          busy={busy}
          width="38rem"
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setAllocating(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={allocate} disabled={busy || !alloc.assetId || !alloc.employeeId || !alloc.allocatedOn}>
                {busy && <span className="spinner" />} Allocate
              </button>
            </>
          }
        >
          {dialogError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <span>{dialogError}</span>
            </div>
          )}
          {assets && assets.length === 0 && !dialogError && (
            <div className="banner bannerInfo" style={{ marginBottom: "0.75rem" }}>
              <span>
                No assets are available. <Link href="/hr-assets/new" className="textLink">Add one to the asset register</Link>.
              </span>
            </div>
          )}
          <div className="formGrid">
            <div className="field fieldSpanFull">
              <label htmlFor="al-asset">Asset</label>
              <SearchSelect
                id="al-asset"
                value={alloc.assetId}
                options={assetOptions}
                onChange={(v) => setAlloc({ ...alloc, assetId: v, condition: assets?.find((a) => a.id === v)?.condition ?? alloc.condition })}
                placeholder={assets ? "Search tag, name or serial no." : "Loading…"}
              />
            </div>
            <div className="field fieldSpanFull">
              <label htmlFor="al-emp">Employee</label>
              <SearchSelect id="al-emp" value={alloc.employeeId} options={(employees ?? []).map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => setAlloc({ ...alloc, employeeId: v })} placeholder="Search employee" />
            </div>
            <div className="field">
              <label htmlFor="al-date">Allocated on</label>
              <input id="al-date" className="input" type="date" value={alloc.allocatedOn} onChange={(e) => setAlloc({ ...alloc, allocatedOn: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="al-back">
                Expected back<span className="hint"> · optional</span>
              </label>
              <input id="al-back" className="input" type="date" value={alloc.expectedReturnDate} onChange={(e) => setAlloc({ ...alloc, expectedReturnDate: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="al-cond">Condition when given</label>
              <Select id="al-cond" className="select" value={alloc.condition} onChange={(e) => setAlloc({ ...alloc, condition: e.target.value })}>
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="field">
              <label htmlFor="al-notes">Notes</label>
              <input id="al-notes" className="input" value={alloc.notes} onChange={(e) => setAlloc({ ...alloc, notes: e.target.value })} placeholder="Charger, bag included…" />
            </div>
          </div>
        </Modal>
      )}

      {returning && (
        <Modal
          title={`Return ${returning.assetTag}`}
          subtitle={`${returning.assetName} from ${returning.employeeName}, held since ${fmtDate(returning.allocatedOn)} (given in ${(CONDITION_LABEL[returning.conditionAtIssue] ?? returning.conditionAtIssue).toLowerCase()} condition).`}
          onClose={() => setReturning(null)}
          busy={busy}
          width="36rem"
          footer={
            <>
              <button type="button" className="button buttonSecondary" onClick={() => setReturning(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button buttonPrimary" onClick={submitReturn} disabled={busy || !ret.returnedOn}>
                {busy && <span className="spinner" />} {ret.outcome === "LOST" ? "Record as lost" : "Take back"}
              </button>
            </>
          }
        >
          {dialogError && (
            <div className="banner bannerError" style={{ marginBottom: "0.75rem" }}>
              <span>{dialogError}</span>
            </div>
          )}
          <div className="formGrid">
            <div className="field">
              <label htmlFor="rt-date">{ret.outcome === "LOST" ? "Reported lost on" : "Returned on"}</label>
              <input id="rt-date" className="input" type="date" value={ret.returnedOn} onChange={(e) => setRet({ ...ret, returnedOn: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="rt-outcome">Outcome</label>
              <Select id="rt-outcome" className="select" value={ret.outcome} onChange={(e) => setRet({ ...ret, outcome: e.target.value, condition: e.target.value === "DAMAGED" ? "DAMAGED" : ret.condition })}>
                <option value="RETURNED">Returned in working order</option>
                <option value="DAMAGED">Returned damaged (send for repair)</option>
                <option value="LOST">Lost / not returned</option>
              </Select>
            </div>
            {ret.outcome !== "LOST" && (
              <div className="field">
                <label htmlFor="rt-cond">Condition now</label>
                <Select id="rt-cond" className="select" value={ret.condition} onChange={(e) => setRet({ ...ret, condition: e.target.value })}>
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {ret.outcome !== "RETURNED" && (
              <div className="field">
                <label htmlFor="rt-rec">
                  Amount to recover<span className="hint"> · asset value {formatMoney(returning.value)}</span>
                </label>
                <input id="rt-rec" className="input" inputMode="decimal" value={ret.recoveryAmount} onChange={(e) => setRet({ ...ret, recoveryAmount: e.target.value })} placeholder="0" />
              </div>
            )}
            <div className="field fieldSpanFull">
              <label htmlFor="rt-notes">
                Notes{ret.outcome === "LOST" ? "" : <span className="hint"> · optional</span>}
              </label>
              <input id="rt-notes" className="input" value={ret.notes} onChange={(e) => setRet({ ...ret, notes: e.target.value })} placeholder={ret.outcome === "LOST" ? "What happened" : "Scratches on lid, charger missing…"} />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
