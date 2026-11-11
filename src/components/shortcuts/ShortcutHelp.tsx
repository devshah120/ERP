"use client";

import { useEffect, useState } from "react";
import { useShortcuts } from "@/lib/shortcuts/ShortcutProvider";
import { SHORTCUTS, displayKeys, isMacPlatform, type ShortcutScopeName } from "@/lib/shortcuts/registry";

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

  if (!helpOpen) return null;

  return (
    <div className="modalBackdrop" onClick={closeHelp}>
      <div className="modalCard shortcutModal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="modalHeader">
          <div>
            <div className="modalTitle">Keyboard shortcuts</div>
            <div className="modalSubtitle">
              Press <kbd>{mac ? "⌘" : "Ctrl"}</kbd> + <kbd>/</kbd> at any time to open or close this list.
              {mac ? " On this Mac, ⌘ replaces Ctrl and ⌥ replaces Alt." : ""}
            </div>
          </div>
          <button type="button" className="button buttonSecondary" onClick={closeHelp}>
            Close
          </button>
        </div>

        <div className="modalBody">
          {SCOPE_ORDER.map((scope) => {
            const rows = SHORTCUTS.filter((s) => s.scope === scope);
            if (rows.length === 0) return null;
            return (
              <section key={scope} className="shortcutSection">
                <h3>{scope}</h3>
                <p className="shortcutBlurb">{SCOPE_BLURB[scope]}</p>
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

          <p className="shortcutFootnote">
            Global shortcuts stay out of your way while you type: pressing N or E inside a field types the
            letter. The exceptions are deliberate — Ctrl + S saves from inside a form, and Ctrl + / opens this
            list from anywhere.
          </p>
        </div>
      </div>
    </div>
  );
}
