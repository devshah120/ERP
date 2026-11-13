"use client";

import { useEffect, useRef, useState, type RefObject, type MouseEvent } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import { IconChevronDown, IconLayers } from "@/components/icons";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

export interface ColumnOption {
  key: string;
  label: string;
  /** Can't be hidden (shown as "Required"). Defaults to the first column. */
  required?: boolean;
}

/**
 * "Columns" picker shared by every listing screen: a checklist with Select all,
 * Reset and Save.
 */
export default function ColumnPicker({
  options,
  hidden,
  onApply,
  buttonRef,
}: {
  options: ColumnOption[];
  hidden: string[];
  /** Saves the new set of hidden column keys. */
  onApply: (hidden: string[]) => void;
  /** Lets the Ctrl + Shift + K shortcut open this picker from the page above. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const [draft, setDraft] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const isRequired = (o: ColumnOption, i: number) => o.required ?? i === 0;
  const optional = options.filter((o, i) => !isRequired(o, i));

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    setDraft(hidden.filter((k) => options.some((o, i) => o.key === k && !isRequired(o, i))));
    setAnchorEl(e.currentTarget);
  };

  const close = () => setAnchorEl(null);
  useEscapeHandler(close, open);

  const shownOptional = optional.filter((o) => !draft.includes(o.key)).length;
  const allShown = shownOptional === optional.length;
  const isIndeterminate = shownOptional > 0 && shownOptional < optional.length;

  function toggle(key: string) {
    setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  }

  function save() {
    onApply(draft);
    close();
  }

  const visibleCount = options.length - hidden.length;

  return (
    <div className="columnPicker">
      <button
        ref={(el) => {
          triggerRef.current = el;
          if (buttonRef) buttonRef.current = el;
        }}
        type="button"
        className="button buttonSecondary"
        onClick={(e) => (open ? close() : handleOpen(e))}
        title="Choose columns (Ctrl + Shift + K)"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <IconLayers />
        Columns
        {hidden.length > 0 && (
          <span className="columnPickerCount">
            {visibleCount}/{options.length}
          </span>
        )}
        <IconChevronDown style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }} />
      </button>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            elevation: 6,
            sx: {
              width: 290,
              p: 0,
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: "divider",
              mt: 1,
            },
          },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            p: 1.5,
            px: 2,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Columns
          </Typography>
          <Button
            size="small"
            onClick={() => setDraft([])}
            disabled={draft.length === 0}
            sx={{ textTransform: "none", fontSize: "0.75rem", p: 0.5 }}
          >
            Reset
          </Button>
        </Box>

        <Box sx={{ px: 2, py: 1, bgcolor: "var(--surface-subtle, #f8fbfd)", borderBottom: "1px solid", borderColor: "divider" }}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={allShown}
                indeterminate={isIndeterminate}
                onChange={() => setDraft(allShown ? optional.map((o) => o.key) : [])}
                disabled={optional.length === 0}
              />
            }
            label={
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.8125rem" }}>
                  Select all
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {options.length - draft.length}/{options.length}
                </Typography>
              </Box>
            }
            sx={{ m: 0, width: "100%" }}
          />
        </Box>

        <Box sx={{ maxHeight: 260, overflowY: "auto", px: 2, py: 0.5 }}>
          {options.map((o, i) => {
            const req = isRequired(o, i);
            const isChecked = req || !draft.includes(o.key);

            return (
              <Box
                key={o.key}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  py: 0.25,
                }}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={isChecked}
                      disabled={req}
                      onChange={() => toggle(o.key)}
                    />
                  }
                  label={
                    <Typography
                      variant="body2"
                      sx={{
                        fontSize: "0.8125rem",
                        color: req ? "text.secondary" : "text.primary",
                      }}
                    >
                      {o.label}
                    </Typography>
                  }
                  sx={{ m: 0, flex: 1 }}
                />
                {req && (
                  <Typography variant="caption" sx={{ color: "text.disabled", fontSize: "0.6875rem" }}>
                    Required
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>

        <Divider />

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            p: 1.5,
            bgcolor: "var(--surface-subtle, #f8fbfd)",
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.6875rem" }}>
            Applies to export too
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button size="small" variant="outlined" color="inherit" onClick={close} sx={{ textTransform: "none", fontSize: "0.75rem" }}>
              Close
            </Button>
            <Button size="small" variant="contained" onClick={save} disableElevation sx={{ textTransform: "none", fontSize: "0.75rem", fontWeight: 600 }}>
              Save
            </Button>
          </Box>
        </Box>
      </Popover>
    </div>
  );
}
