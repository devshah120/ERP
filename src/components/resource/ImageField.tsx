"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** What the form will do with the image when it is saved. */
export type PendingImage = File | "remove" | undefined;

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * A photo picker with a round preview. Nothing is uploaded here: the chosen
 * file (or "remove") is handed to the form, which sends it once the record is
 * saved. `currentUrl` is the photo already stored, if any.
 */
export default function ImageField({
  id,
  currentUrl,
  pending,
  onChange,
  fallback,
  disabled,
}: {
  id: string;
  currentUrl: string | null;
  pending: PendingImage;
  onChange: (next: PendingImage) => void;
  /** Shown in the circle when there is no photo, e.g. the person's initials. */
  fallback: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (pending instanceof File ? URL.createObjectURL(pending) : null), [pending]);
  // Frees the preview's object URL when the file changes or the field goes away.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const shown = pending === "remove" ? null : preview ?? currentUrl;

  function pick(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) return setError("Choose a JPG or PNG photo.");
    if (file.size > MAX_BYTES) return setError("The photo is larger than 2 MB.");
    onChange(file);
  }

  return (
    <div className="imageField">
      <div className="imageFieldPreview" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API image or a local object URL, not a static asset */}
        {shown ? <img src={shown} alt="" /> : <span>{fallback || "?"}</span>}
      </div>
      <div className="imageFieldActions">
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          disabled={disabled}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="button buttonSecondary buttonSm" onClick={() => inputRef.current?.click()} disabled={disabled}>
            {shown ? "Change photo" : "Upload photo"}
          </button>
          {pending instanceof File && (
            <button type="button" className="button buttonGhost buttonSm" onClick={() => onChange(undefined)} disabled={disabled}>
              Undo
            </button>
          )}
          {currentUrl && pending !== "remove" && !(pending instanceof File) && (
            <button type="button" className="button buttonGhost buttonSm" onClick={() => onChange("remove")} disabled={disabled}>
              Remove
            </button>
          )}
          {pending === "remove" && (
            <button type="button" className="button buttonGhost buttonSm" onClick={() => onChange(undefined)} disabled={disabled}>
              Keep photo
            </button>
          )}
        </div>
        <span className="hrMuted">{pending === "remove" ? "The photo will be removed when you save." : "JPG or PNG, up to 2 MB. Saved with the record."}</span>
        {error && <span className="fieldError">{error}</span>}
      </div>
    </div>
  );
}
