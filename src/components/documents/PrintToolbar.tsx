"use client";

import { useRouter } from "next/navigation";
import { useShortcutScope } from "@/lib/shortcuts/ShortcutProvider";
import { IconPrint } from "@/components/icons";

/** The only interactive part of the print screen — kept as a small client
 *  island so the document sheet itself renders on the server. */
export default function PrintToolbar({ label }: { label: string }) {
  const router = useRouter();

  // Ctrl+P goes through the same handler as the button. The browser's own
  // print dialog would work too, but routing it here keeps one code path.
  useShortcutScope({ onPrint: () => window.print() });

  return (
    <div className="printToolbar">
      <div>
        <strong>Print preview</strong> — {label}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" className="button buttonSecondary" onClick={() => router.back()}>
          Back
        </button>
        <button
          type="button"
          className="button buttonPrimary"
          onClick={() => window.print()}
          title="Print (Ctrl + P)"
        >
          <IconPrint /> Print
        </button>
      </div>
    </div>
  );
}
