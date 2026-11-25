"use client";

import { useMemo, useState } from "react";
import type { ReferenceOption } from "./LinesEditor";

/**
 * Picks several records of a master with checkboxes, e.g. every contractor a
 * worker works under. Long lists get a filter box; the ticked ones stay listed
 * first so they are never lost below the fold.
 */
export default function MultiReferenceField({
  id,
  value,
  options,
  onChange,
  invalid,
}: {
  id: string;
  value: string[];
  options: ReferenceOption[];
  onChange: (next: string[]) => void;
  invalid?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const picked = useMemo(() => new Set(value), [value]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.detail ?? "").toLowerCase().includes(q)) : options;
    return [...list].sort((a, b) => Number(picked.has(b.value)) - Number(picked.has(a.value)));
  }, [options, filter, picked]);

  function toggle(v: string) {
    onChange(picked.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  if (options.length === 0) {
    return (
      <div id={id} className="multiRef multiRefEmpty" data-invalid={invalid || undefined}>
        Nothing to choose yet. Add records first.
      </div>
    );
  }

  return (
    <div id={id} className="multiRef" role="group" data-invalid={invalid || undefined}>
      {options.length > 8 && (
        <div className="multiRefBar">
          <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" aria-label="Filter the list" />
          <span className="hint">{value.length} selected</span>
          {value.length > 0 && (
            <button type="button" className="button buttonGhost buttonSm" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      )}
      <div className="multiRefList">
        {shown.map((o) => (
          <label key={o.value} className="checkboxRow multiRefItem">
            <input type="checkbox" checked={picked.has(o.value)} onChange={() => toggle(o.value)} />
            <span>
              {o.label}
              {o.detail && <span className="hint"> · {o.detail}</span>}
            </span>
          </label>
        ))}
        {shown.length === 0 && <span className="hint">Nothing matches “{filter}”.</span>}
      </div>
    </div>
  );
}
