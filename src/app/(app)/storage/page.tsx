"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useAuth } from "../AuthProvider";
import { apiFetch, ApiError } from "@/lib/api/client";
import PageHeader from "@/components/ui/PageHeader";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/table/ConfirmDialog";
import AccessDenied from "@/components/ui/AccessDenied";
import { EmptyState, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { IconDownload, IconEye, IconFile, IconPlus, IconTrash, IconUpload } from "@/components/icons";

interface StoredFileRow {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  remarks: string;
  createdByName: string;
  createdAt: string;
}

interface ListResult {
  items: StoredFileRow[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function kindOf(mime: string) {
  return mime === "application/pdf" ? "PDF" : mime === "image/png" ? "PNG" : "JPG";
}

/**
 * Utilities → Storage: the company's document drive. Upload JPG, PNG or PDF
 * files with a name and remarks; view, download or delete them later.
 */
export default function StoragePage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canUpload = hasPermission("storage.upload");
  const canDelete = hasPermission("storage.delete");

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [toDelete, setToDelete] = useState<StoredFileRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (debounced) params.set("query", debounced);
      setData(await apiFetch<ListResult>(`/api/storage?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debounced]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch(`/api/storage/${toDelete.id}`, { method: "DELETE" });
      toast.success("Document deleted", toDelete.name);
      setToDelete(null);
      load();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete the document");
    } finally {
      setDeleting(false);
    }
  }

  if (!hasPermission("storage.view")) return <AccessDenied detail="Opening Storage needs the Storage · view permission." />;

  const rows = data?.items ?? [];
  const startIndex = ((data?.page ?? 1) - 1) * (data?.pageSize ?? pageSize);

  return (
    <>
      <PageHeader
        title="Storage"
        count={data?.total ?? null}
        description="Company documents — agreements, licences, logos, scanned bills — kept with your workspace."
        actions={
          canUpload && (
            <button type="button" className="button buttonPrimary" onClick={() => setUploadOpen(true)}>
              <IconPlus /> New document
            </button>
          )
        }
      />

      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search name, file or remarks…" width="20rem" />
      </div>

      {error && (
        <div className="banner bannerError" role="alert" style={{ marginBottom: "0.75rem" }}>
          {error}
        </div>
      )}

      <div className="tableWrap">
        {loading && data && <div className="loadingBar" />}
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: "3rem" }}>#</th>
              <th>Document name</th>
              <th>File</th>
              <th>Uploaded by</th>
              <th>Uploaded on</th>
              <th>Remarks</th>
              <th className="actionCell">
                <span className="srOnly">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && <SkeletonRows columns={7} />}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  {debounced ? (
                    <EmptyState variant="search" title="No matching documents" description={`Nothing matches “${debounced}”.`} />
                  ) : (
                    <EmptyState
                      title="No documents yet"
                      description="Upload agreements, licences, logos or scanned bills to keep them in one place."
                      actions={
                        canUpload && (
                          <button type="button" className="button buttonPrimary" onClick={() => setUploadOpen(true)}>
                            <IconPlus /> New document
                          </button>
                        )
                      }
                    />
                  )}
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="cellMuted">{startIndex + i + 1}</td>
                <td>
                  <a href={`/api/storage/${r.id}/file`} target="_blank" rel="noopener noreferrer" className="cellLink">
                    {r.name}
                  </a>
                </td>
                <td>
                  <div className="stFile">
                    <span className={`stKind stKind-${kindOf(r.mimeType)}`}>{kindOf(r.mimeType)}</span>
                    <div>
                      <div className="stFileName" title={r.fileName}>
                        {r.fileName}
                      </div>
                      <div className="cellSub">{formatSize(r.size)}</div>
                    </div>
                  </div>
                </td>
                <td>{r.createdByName || "—"}</td>
                <td className="cellMuted">
                  {new Date(r.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="stRemarks" title={r.remarks}>
                  {r.remarks || "—"}
                </td>
                <td className="actionCell">
                  <div className="stActions">
                    <a href={`/api/storage/${r.id}/file`} target="_blank" rel="noopener noreferrer" className="rowRemoveBtn stAction" title="View" aria-label={`View ${r.name}`}>
                      <IconEye />
                    </a>
                    <a href={`/api/storage/${r.id}/file?download=1`} className="rowRemoveBtn stAction" title="Download" aria-label={`Download ${r.name}`}>
                      <IconDownload />
                    </a>
                    {canDelete && (
                      <button type="button" className="rowRemoveBtn" title="Delete" aria-label={`Delete ${r.name}`} onClick={() => (setDeleteError(null), setToDelete(r))}>
                        <IconTrash />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPage={setPage}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        )}
      </div>

      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onUploaded={(row) => {
            setUploadOpen(false);
            toast.success("Document uploaded", row.name);
            setPage(1);
            load();
          }}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete this document?"
          message={`“${toDelete.name}” (${toDelete.fileName}) will be removed from Storage permanently.`}
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* New document                                                        */
/* ------------------------------------------------------------------ */

function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: (row: StoredFileRow) => void }) {
  const [name, setName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; file?: string; remarks?: string; form?: string }>({});
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined | null) {
    if (!f) return;
    const okType = /\.(jpe?g|png|pdf)$/i.test(f.name) || ["image/jpeg", "image/png", "application/pdf"].includes(f.type);
    if (!okType) {
      setErrors((e) => ({ ...e, file: "Only JPG, JPEG, PNG or PDF files" }));
      return;
    }
    if (f.size > MAX_BYTES) {
      setErrors((e) => ({ ...e, file: "That file is larger than 10 MB" }));
      return;
    }
    setFile(f);
    setErrors((e) => ({ ...e, file: undefined }));
    // A sensible default name: the file name without its extension.
    setName((n) => n || f.name.replace(/\.[^.]+$/, "").slice(0, 150));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    pick(e.dataTransfer.files?.[0]);
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Document name is required";
    if (!file) next.file = "Choose a file to upload";
    if (!remarks.trim()) next.remarks = "Remarks are required";
    setErrors(next);
    if (Object.keys(next).length > 0 || !file) return;

    setSaving(true);
    try {
      const form = new FormData();
      form.set("name", name.trim());
      form.set("remarks", remarks.trim());
      form.set("file", file);
      onUploaded(await apiFetch<StoredFileRow>("/api/storage", { method: "POST", body: form }));
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : "Could not upload the document" });
      setSaving(false);
    }
  }

  return (
    <Modal
      title="New document"
      onClose={onClose}
      busy={saving}
      width="30rem"
      footer={
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          <button type="button" className="button buttonSecondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="button buttonPrimary" onClick={() => save()} disabled={saving}>
            {saving && <span className="spinner" />} Save
          </button>
        </div>
      }
    >
      <form className="form" onSubmit={save} noValidate>
        {errors.form && (
          <div className="banner bannerError" role="alert">
            {errors.form}
          </div>
        )}
        <div className="field">
          <label htmlFor="st-name">
            Document name <span className="regRequired">*</span>
          </label>
          <input id="st-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} autoFocus aria-invalid={!!errors.name} />
          {errors.name && <span className="fieldError">{errors.name}</span>}
        </div>

        <div className="field">
          <span className="stLabel">
            Add document <span className="regRequired">*</span>
          </span>
          <div
            className={`stDrop ${dragOver ? "isOver" : ""} ${errors.file ? "isError" : ""}`}
            onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <span className="stDropName">
              {file ? (
                <>
                  <IconFile /> {file.name} <small>{formatSize(file.size)}</small>
                </>
              ) : (
                "Choose file or drop it here"
              )}
            </span>
            <button type="button" className="button buttonSecondary buttonSm" onClick={() => inputRef.current?.click()}>
              <IconUpload /> Browse
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          {errors.file ? <span className="fieldError">{errors.file}</span> : <span className="fieldHint">Accepted formats: JPG, JPEG, PNG, PDF · up to 10 MB</span>}
        </div>

        <div className="field">
          <label htmlFor="st-remarks">
            Remarks <span className="regRequired">*</span>
          </label>
          <textarea id="st-remarks" className="input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} aria-invalid={!!errors.remarks} />
          {errors.remarks && <span className="fieldError">{errors.remarks}</span>}
        </div>
      </form>
    </Modal>
  );
}
