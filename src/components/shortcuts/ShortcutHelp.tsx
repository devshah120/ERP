"use client";

import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { useShortcuts } from "@/lib/shortcuts/ShortcutProvider";
import { SHORTCUTS, displayKeys, isMacPlatform, type ShortcutScopeName } from "@/lib/shortcuts/registry";
import { IconClose } from "@/components/icons";

const SCOPE_ORDER: ShortcutScopeName[] = ["Global", "Listing", "Form", "Document", "POS", "Navigation"];

const SCOPE_BLURB: Record<ShortcutScopeName, string> = {
  Global: "Work anywhere in the ERP.",
  Listing: "Work on any list screen — masters, documents and reports.",
  Form: "Work while a create or edit form is open.",
  Document: "Work on sales and purchase documents.",
  POS: "Work on the Point of Sale billing counter.",
  Navigation: "Jump straight to a screen or start a new entry from anywhere.",
};

/**
 * The shortcut reference, opened with Ctrl + / or from the top bar.
 * It renders from the same registry the key handler uses, so the table can
 * never drift from what actually works.
 */
export default function ShortcutHelp() {
  const { helpOpen, closeHelp } = useShortcuts();
  const [mac, setMac] = useState(false);

  useEffect(() => {
    // Platform is a browser fact, so it is read after mount rather than
    // guessed during render — otherwise the server and client disagree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMac(isMacPlatform());
  }, []);

  return (
    <Dialog
      open={helpOpen}
      onClose={closeHelp}
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: {
          elevation: 6,
          sx: {
            borderRadius: 3,
            overflow: "hidden",
            maxHeight: "88vh",
          },
        },
      }}
      aria-label="Keyboard shortcuts"
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          p: 2.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box sx={{ minWidth: 0, pr: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: "1.0625rem" }}>
            Keyboard shortcuts
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8125rem", mt: 0.5 }}>
            Press <kbd>{mac ? "⌘" : "Ctrl"}</kbd> + <kbd>/</kbd> at any time to open or close this list.
            {mac ? " On this Mac, ⌘ replaces Ctrl and ⌥ replaces Alt." : ""}
          </Typography>
        </Box>
        <IconButton
          aria-label="Close"
          onClick={closeHelp}
          size="small"
          sx={{ color: "text.secondary", mt: -0.5, mr: -0.5 }}
        >
          <IconClose />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 2.5 }}>
        {SCOPE_ORDER.map((scope) => {
          const rows = SHORTCUTS.filter((s) => s.scope === scope);
          if (rows.length === 0) return null;
          return (
            <section key={scope} className="shortcutSection" style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.25rem 0", color: "var(--text-strong)" }}>
                {scope}
              </h3>
              <p className="shortcutBlurb" style={{ margin: "0 0 0.5rem 0", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                {SCOPE_BLURB[scope]}
              </p>
              <table className="table shortcutTable">
                <thead>
                  <tr>
                    <th style={{ width: "11rem" }}>Shortcut</th>
                    <th>Action</th>
                    <th style={{ width: "10rem" }}>Applies to</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {displayKeys(s.keys, mac)
                          .split(" + ")
                          .map((part, i) => (
                            <span key={part}>
                              {i > 0 && <span className="kbdPlus">+</span>}
                              <kbd>{part}</kbd>
                            </span>
                          ))}
                      </td>
                      <td>{s.description}</td>
                      <td className="shortcutApplies">{s.appliesTo ?? "All modules"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}

        <p className="shortcutFootnote" style={{ marginTop: "1rem", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          Global shortcuts stay out of your way while you type: pressing N or E inside a field types the
          letter. The exceptions are deliberate — Ctrl + S saves from inside a form, and Ctrl + / opens this
          list from anywhere.
        </p>
      </DialogContent>
    </Dialog>
  );
}
