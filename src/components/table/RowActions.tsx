"use client";

import { useState, type ReactNode, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { IconDots } from "@/components/icons";

export interface RowAction {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Either navigate… */
  href?: string;
  /** …or run something. */
  onSelect?: () => void;
  /** Set to explain *why* the action is unavailable, rather than hiding it. */
  disabledReason?: string;
  tone?: "default" | "danger";
  /** Shown as an icon button on the row instead of inside the menu. */
  primary?: boolean;
}

/**
 * The per-row action cluster: a few primary actions as icon buttons, the
 * rest behind a kebab menu.
 */
export default function RowActions({ actions }: { actions: RowAction[] }) {
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  function run(action: RowAction) {
    handleClose();
    if (action.disabledReason) return;
    if (action.href) router.push(action.href);
    else action.onSelect?.();
  }

  const primary = actions.filter((a) => a.primary);
  const menu = actions.filter((a) => !a.primary);

  return (
    <div className="rowActions">
      {primary.map((a) => {
        const btn = (
          <button
            key={a.key}
            type="button"
            className="rowActionIcon"
            aria-label={a.label}
            disabled={Boolean(a.disabledReason)}
            onClick={(e) => {
              e.stopPropagation();
              run(a);
            }}
          >
            {a.icon}
          </button>
        );

        return a.disabledReason ? (
          <Tooltip key={a.key} title={a.disabledReason} arrow placement="top">
            <span style={{ display: "inline-flex" }}>{btn}</span>
          </Tooltip>
        ) : (
          btn
        );
      })}

      {menu.length > 0 && (
        <>
          <button
            type="button"
            className={`rowActionIcon ${open ? "rowActionIconOpen" : ""}`}
            title="More actions"
            aria-label="More actions"
            aria-expanded={open}
            onClick={handleOpen}
          >
            <IconDots />
          </button>

          <Menu
            anchorEl={anchorEl}
            open={open}
            onClose={handleClose}
            slotProps={{
              paper: {
                elevation: 4,
                sx: {
                  minWidth: "13rem",
                  borderRadius: 2,
                  border: "1px solid",
                  borderColor: "divider",
                  py: 0.5,
                },
              },
            }}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            {menu.map((a) => {
              const isDanger = a.tone === "danger";
              const isDisabled = Boolean(a.disabledReason);

              return (
                <MenuItem
                  key={a.key}
                  disabled={isDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    run(a);
                  }}
                  sx={{
                    py: 0.75,
                    px: 1.5,
                    color: isDanger && !isDisabled ? "error.main" : undefined,
                  }}
                >
                  {a.icon && (
                    <ListItemIcon
                      sx={{
                        minWidth: 28,
                        color: isDanger && !isDisabled ? "error.main" : "text.secondary",
                      }}
                    >
                      {a.icon}
                    </ListItemIcon>
                  )}
                  <ListItemText
                    primary={
                      <Box>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 500,
                            color: isDanger && !isDisabled ? "error.main" : "text.primary",
                          }}
                        >
                          {a.label}
                        </Typography>
                        {a.disabledReason && (
                          <Typography variant="caption" sx={{ color: "text.disabled", display: "block", fontSize: "0.6875rem" }}>
                            {a.disabledReason}
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                </MenuItem>
              );
            })}
          </Menu>
        </>
      )}
    </div>
  );
}
