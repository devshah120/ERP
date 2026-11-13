"use client";

import type { Ref } from "react";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import { IconClose, IconSearch } from "@/components/icons";

/**
 * Modernized SearchBox built on Material UI TextField.
 * Includes search icon adornment, clear button, and shortcut tooltip support.
 */
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
    <TextField
      inputRef={inputRef}
      size="small"
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      aria-label={placeholder}
      sx={{
        width: width ?? { xs: "100%", sm: 260 },
        "& .MuiOutlinedInput-root": {
          bgcolor: "var(--surface, #ffffff)",
          borderRadius: "6px",
          height: 34,
          fontSize: "0.8125rem",
        },
      }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start" sx={{ color: "text.secondary", mr: 0.75 }}>
              <IconSearch />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                aria-label="Clear search"
                onClick={() => onChange("")}
                edge="end"
                sx={{ p: 0.25, color: "text.secondary" }}
              >
                <IconClose />
              </IconButton>
            </InputAdornment>
          ) : null,
        },
      }}
    />
  );
}
