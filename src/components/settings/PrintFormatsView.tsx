"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/app/(app)/AuthProvider";
import {
  PAPER_SIZES,
  PRINT_DOC_TYPES,
  PRINT_DOC_TYPE_MAP,
  PRINT_GROUP_LABELS,
  PRINT_LAYOUTS,
  resolveLayout,
  type LayoutId,
  type PaperSize,
  type PrintDocTypeDef,
  type PrintGroup,
} from "@/lib/printFormats/catalog";
import { sampleModel, type PrintBusiness, type PrintModel } from "@/components/print/model";
import { ScaledSheet } from "@/components/print/PrintArea";
import PageHeader from "@/components/ui/PageHeader";
import Modal from "@/components/ui/Modal";
import { SkeletonBlock } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { IconAlertCircle, IconArrowLeft, IconCheck, IconEye, IconFile, IconPlus } from "@/components/icons";

const GROUPS: PrintGroup[] = ["POS", "SALES", "PURCHASE"];

function sampleFor(type: PrintDocTypeDef, business: PrintBusiness): PrintModel {
  if (type.key === "pos-orders") return sampleModel(business, "pos", "TAX INVOICE");
  if (type.key === "pos-credit-notes") return sampleModel(business, "pos-return", "CREDIT NOTE");
  const title = type.key === "sales-invoices" ? "Tax Invoice" : type.label;
  return sampleModel(business, "document", title, type.group === "PURCHASE" ? "vendor" : "customer");
}

function ChevronRight(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/**
 * Settings · Print Formats. Pick, per document type, the layout used for
 * printing. A choice saves at once and applies to the next print anywhere:
 * the POS register, reprints and every document's Print screen.
 */
export default function PrintFormatsView({ initialType }: { initialType?: string }) {
  const { me, hasPermission } = useAuth();
  const toast = useToast();
  const canEdit = hasPermission("settings.edit");

  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeKey, setTypeKey] = useState(() => (PRINT_DOC_TYPES.some((d) => d.key === initialType) ? initialType! : PRINT_DOC_TYPES[0].key));
  const [sizeFilter, setSizeFilter] = useState<PaperSize | "ANY">("ANY");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<LayoutId | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Record<string, string>>("/api/settings/print-formats")
      .then((v) => !cancelled && setValues(v))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load print formats"));
    return () => {
      cancelled = true;
    };
  }, []);

  const type = PRINT_DOC_TYPES.find((d) => d.key === typeKey) ?? PRINT_DOC_TYPES[0];
  const inUse = resolveLayout(type.key, values?.[type.key]).id;
  const sizes = [...new Set(type.layouts.map((id) => PRINT_LAYOUTS[id].size))];
  const shown = type.layouts.filter((id) => sizeFilter === "ANY" || PRINT_LAYOUTS[id].size === sizeFilter);

  const business = me?.business;
  const sample = useMemo(
    () => sampleFor(PRINT_DOC_TYPE_MAP[typeKey] ?? PRINT_DOC_TYPES[0], { ...business, name: business?.name || "Your Business" }),
    [typeKey, business]
  );

  function selectType(key: string) {
    setTypeKey(key);
    setSizeFilter("ANY");
    window.history.replaceState(null, "", `?type=${encodeURIComponent(key)}`);
  }

  async function use(id: LayoutId) {
    if (!values || !canEdit || id === inUse) return;
    const next = { ...values, [type.key]: id };
    setSavingId(id);
    try {
      setValues(await apiFetch<Record<string, string>>("/api/settings/print-formats", { method: "PUT", body: JSON.stringify(next) }));
      toast.success(`${type.label} now prints as ${PRINT_LAYOUTS[id].name}`);
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : "Check your connection and try again.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/settings" className="textLink" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <IconArrowLeft /> Settings
          </Link>
        }
        title="Print Formats"
        description="Pick the layout used when printing each document type. A choice saves at once and is used for the next print on every counter."
      />

      {!canEdit && (
        <div className="banner bannerLocked" style={{ marginBottom: "1rem" }}>
          <span>You can browse the formats. Changing them needs the Settings · edit permission.</span>
        </div>
      )}
      {error && (
        <div className="banner bannerError" role="alert" style={{ marginBottom: "1rem" }}>
          <IconAlertCircle />
          <span>{error}</span>
        </div>
      )}

      <div className="pfmLayout">
        <nav className="pfmTypes" aria-label="Document types">
          {GROUPS.map((g) => (
            <div key={g}>
              <div className="pfmGroupLabel">{PRINT_GROUP_LABELS[g]}</div>
              {PRINT_DOC_TYPES.filter((d) => d.group === g).map((d) => {
                const active = d.key === type.key;
                const current = resolveLayout(d.key, values?.[d.key]);
                return (
                  <button key={d.key} type="button" className="pfmType" aria-current={active} onClick={() => selectType(d.key)}>
                    <span className="pfmTypeIcon">
                      <IconFile />
                    </span>
                    <span className="pfmTypeText">
                      <strong>{d.label}</strong>
                      <small title={current.name}>
                        {d.layouts.length} layouts{values ? ` · ${PAPER_SIZES[current.size].short}` : ""}
                      </small>
                    </span>
                    {active && <ChevronRight className="pfmChevron" />}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <section className="pfmPanel" aria-labelledby="pfm-title">
          <div className="pfmPanelHead">
            <div className="pfmPanelTitle" id="pfm-title">
              {type.label}
              <small>· {type.layouts.length} layouts</small>
            </div>
            {sizes.length > 1 && (
              <div className="pfmChips" role="group" aria-label="Filter by paper size">
                <span className="pfmChipsLabel">Size</span>
                <button type="button" className="pfmChip" aria-pressed={sizeFilter === "ANY"} onClick={() => setSizeFilter("ANY")}>
                  Any
                </button>
                {sizes.map((s) => (
                  <button key={s} type="button" className="pfmChip" aria-pressed={sizeFilter === s} onClick={() => setSizeFilter(s)}>
                    {PAPER_SIZES[s].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!values && !error ? (
            <div className="pfmCards">
              <SkeletonBlock lines={6} />
            </div>
          ) : (
            <div className="pfmCards">
              {shown.map((id) => {
                const layout = PRINT_LAYOUTS[id];
                const active = id === inUse;
                return (
                  <article key={id} className="pfmCard" data-active={active}>
                    <button type="button" className="pfmThumb" onClick={() => setPreview(id)} aria-label={`Preview ${layout.name}`} title="Preview">
                      <ScaledSheet layoutId={id} model={sample} width={PAPER_SIZES[layout.size].thermal ? 62 : 76} maxHeight={96} />
                    </button>
                    <div className="pfmCardBody">
                      <div className="pfmCardName">
                        {layout.name}
                        {active && (
                          <span className="pfmInUse">
                            <IconCheck /> IN USE
                          </span>
                        )}
                      </div>
                      <p className="pfmCardDesc">{layout.description}</p>
                      <div className="pfmTags">
                        <span className="pfmTag">{PAPER_SIZES[layout.size].label}</span>
                        {id === type.defaultLayout && <span className="pfmTag">Default</span>}
                      </div>
                    </div>
                    <div className="pfmCardActions">
                      <button type="button" className="button buttonSecondary buttonSm" onClick={() => setPreview(id)}>
                        <IconEye /> Preview
                      </button>
                      <button
                        type="button"
                        className="button buttonPrimary buttonSm"
                        onClick={() => use(id)}
                        disabled={!canEdit || active || savingId !== null}
                        aria-pressed={active}
                      >
                        {savingId === id ? <span className="spinner" /> : active ? <IconCheck /> : <IconPlus />}
                        {active ? "In use" : "Use this"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {preview && (
        <Modal
          title={PRINT_LAYOUTS[preview].name}
          subtitle={`${type.label} · sample data with your business details`}
          onClose={() => setPreview(null)}
          width={PAPER_SIZES[PRINT_LAYOUTS[preview].size].thermal ? "28rem" : "56rem"}
          footer={
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
              <button type="button" className="button buttonSecondary" onClick={() => setPreview(null)}>
                Close
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="button buttonPrimary"
                  disabled={preview === inUse || savingId !== null}
                  onClick={async () => {
                    await use(preview);
                    setPreview(null);
                  }}
                >
                  {preview === inUse ? (
                    <>
                      <IconCheck /> In use
                    </>
                  ) : (
                    "Use this layout"
                  )}
                </button>
              )}
            </div>
          }
        >
          <div className="pfmPreviewStage">
            <ScaledSheet layoutId={preview} model={sample} width={PAPER_SIZES[PRINT_LAYOUTS[preview].size].thermal ? 340 : 760} />
          </div>
        </Modal>
      )}
    </>
  );
}
