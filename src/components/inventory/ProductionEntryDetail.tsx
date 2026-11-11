"use client";

import DetailShell, { DetailGrid, Panel, fmtDate, type Rec } from "@/components/detail/DetailShell";
import { formatMoney, formatQuantity } from "@/lib/format/number";

function LinesTable({ lines }: { lines: Rec[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Variant</th>
          <th className="numCell">Quantity</th>
          <th className="numCell">Unit cost</th>
          <th className="numCell">Value</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td className="cellPrimary">
              {String(l.itemName)} <span className="cellSub">{String(l.itemCode)}</span>
            </td>
            <td className="cellMono">{String(l.variantSku ?? "—")}</td>
            <td className="numCell">{formatQuantity(String(l.quantity))}</td>
            <td className="numCell">{formatMoney(String(l.unitCost))}</td>
            <td className="numCell">{formatMoney(String(l.value))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Detail for a Material Creation or Material Consumption entry. */
export default function ProductionEntryDetail({ kind, id }: { kind: "material-creation" | "material-consumption"; id: string }) {
  const creation = kind === "material-creation";
  return (
    <DetailShell
      apiPath={`/api/production/${kind}/${id}`}
      backHref={`/${kind}`}
      backLabel={creation ? "Material Creation" : "Material Consumption"}
      title={(r) => <span className="cellMono">{String(r.entryNumber)}</span>}
      description={(r) =>
        creation
          ? `${String((r.output as Rec)?.itemName ?? "")} × ${formatQuantity(String((r.output as Rec)?.quantity ?? 0))} · ${fmtDate(r.entryDate)}`
          : `${String(r.warehouseName ?? "")} · ${fmtDate(r.entryDate)}`
      }
      cancel={{
        permission: `${kind}.cancel`,
        when: (r) => r.status === "POSTED",
        label: "Cancel entry",
        message: creation
          ? "The product goes back out of stock and the components come back in, through offsetting stock-ledger rows."
          : "The materials come back into stock and the write-off is reversed in the ledger.",
      }}
    >
      {(r) => (
        <>
          <Panel title="Entry">
            <DetailGrid
              items={[
                { label: "Date", value: fmtDate(r.entryDate) },
                { label: creation ? "Components from" : "Warehouse", value: String(r.warehouseName ?? "—") },
                ...(creation
                  ? [
                      { label: "Finished goods to", value: String(r.outputWarehouseName ?? r.warehouseName ?? "—") },
                      { label: "Formula", value: (r.formulaName as string) ?? null },
                      { label: "Runs", value: String(r.runs ?? 1) },
                      { label: "Processing cost", value: formatMoney(String(r.processingCost ?? 0)) },
                    ]
                  : [{ label: "Purpose", value: (r.purpose as string) ?? null }]),
                { label: creation ? "Total cost of output" : "Value written off", value: <strong>{formatMoney(String(r.totalValue))}</strong> },
              ]}
            />
            {typeof r.notes === "string" && r.notes && <p className="fieldHint" style={{ marginTop: "0.75rem" }}>{r.notes}</p>}
            {r.status === "CANCELLED" && (
              <div className="banner bannerWarning" style={{ marginTop: "0.75rem" }}>
                Cancelled {fmtDate(r.cancelledAt, true)} — {String(r.cancellationReason ?? "")}
              </div>
            )}
          </Panel>
          {creation && r.output != null && (
            <Panel title="Produced">
              <LinesTable lines={[r.output as Rec]} />
            </Panel>
          )}
          <Panel title={creation ? "Components used" : "Materials issued"}>
            <LinesTable lines={(r.components as Rec[]) ?? []} />
          </Panel>
        </>
      )}
    </DetailShell>
  );
}
