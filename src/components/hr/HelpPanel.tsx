"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PAYROLL_HELP, PAYROLL_SETUP_STEPS } from "@/lib/hr/payrollHelp";
import { IconHelp, IconChevronDown } from "@/components/icons";

/**
 * "How this works" panel for an HR settings screen: what it is for, the
 * steps, a worked example and where it sits in the payroll setup order.
 * Collapsed by default once the user has closed it (remembered per topic).
 */
export default function HelpPanel({ topic }: { topic?: string }) {
  const help = topic ? PAYROLL_HELP[topic] : undefined;
  const storageKey = `help-closed:${topic}`;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the remembered choice lives in the browser only
    if (window.localStorage.getItem(storageKey) === "1") setOpen(false);
  }, [storageKey]);
  if (!help) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "0" : "1");
    } catch {
      /* private mode: just don't remember */
    }
  };
  const stepIndex = PAYROLL_SETUP_STEPS.findIndex((s) => s.key === topic);

  return (
    <section className="helpPanel" aria-label={`How ${help.title} works`}>
      <button type="button" className="helpPanelHead" onClick={toggle} aria-expanded={open}>
        <IconHelp />
        <span className="helpPanelTitle">How this works</span>
        <span className="helpPanelPurpose">{help.purpose}</span>
        <IconChevronDown className="helpPanelChevron" style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>
      {open && (
        <div className="helpPanelBody">
          <div>
            <ol className="helpPanelSteps">
              {help.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {help.tips?.map((t) => (
              <p key={t} className="helpPanelTip">
                {t}
              </p>
            ))}
            {stepIndex >= 0 && (
              <p className="helpPanelTip">
                Payroll setup step {stepIndex + 1} of {PAYROLL_SETUP_STEPS.length}.{" "}
                {stepIndex + 1 < PAYROLL_SETUP_STEPS.length && (
                  <>
                    Next: <Link className="textLink" href={PAYROLL_SETUP_STEPS[stepIndex + 1].href}>{PAYROLL_SETUP_STEPS[stepIndex + 1].label}</Link>.{" "}
                  </>
                )}
                <Link className="textLink" href="/hr/settings">
                  All HR settings
                </Link>
              </p>
            )}
          </div>
          {help.example && (
            <div className="helpPanelExample">
              <div className="helpPanelExampleTitle">Example: {help.example.title}</div>
              <table>
                <tbody>
                  {help.example.rows.map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="tabular">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {help.example.note && <p className="helpPanelTip">{help.example.note}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
