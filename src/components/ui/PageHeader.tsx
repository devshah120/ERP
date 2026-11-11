import type { ReactNode } from "react";

/**
 * The top of every screen: what this is, how much of it there is, and the
 * actions that apply to the whole page. Row-level actions live in the table.
 */
export default function PageHeader({
  title,
  description,
  count,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Record count shown as a pill next to the title. */
  count?: number | null;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="pageHeader">
      <div className="pageHeaderText">
        {eyebrow && <div className="pageEyebrow">{eyebrow}</div>}
        <h1 className="pageTitle">
          {title}
          {typeof count === "number" && <span className="pageTitleCount">{count.toLocaleString("en-IN")}</span>}
        </h1>
        {description && <p className="pageSubtitle">{description}</p>}
      </div>
      {actions && <div className="pageActions">{actions}</div>}
    </div>
  );
}
