"use client";

import type { Ref } from "react";
import { IconClose, IconSearch } from "@/components/icons";

export default function SearchBox({
  value,
  onChange,
  placeholder,
  inputRef,
  title = "Search (Ctrl + F)",
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  title?: string;
  width?: string;
}) {
  return (
    <div className="searchBox" style={width ? { minWidth: width } : undefined}>
      <IconSearch />
      <input
        ref={inputRef}
        className="input"
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={title}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className="searchClear" onClick={() => onChange("")} aria-label="Clear search">
          <IconClose />
        </button>
      )}
    </div>
  );
}
