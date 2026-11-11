"use client";

import { IconChevronLeft, IconChevronRight } from "@/components/icons";

const PAGE_SIZES = [10, 15, 25, 50, 100];

/** Page numbers to show: always first and last, a window around the current page, gaps as null. */
function pageWindow(page: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}

/** Table footer: rows-per-page, the visible range, and page navigation. */
export default function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="tableFooter">
      <div className="pagerSize">
        <label htmlFor="pager-size" className="hideMobile">
          Rows per page
        </label>
        <select
          id="pager-size"
          value={pageSize}
          onChange={(e) => {
            onPageSize(Number(e.target.value));
            onPage(1);
          }}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="tabular">
          {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
        </span>
      </div>

      {totalPages > 1 && (
        <nav className="pager" aria-label="Pagination">
          <button
            type="button"
            className="pagerBtn"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <IconChevronLeft />
          </button>
          {pageWindow(page, totalPages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="pagerGap">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className="pagerBtn"
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPage(p)}
              >
                {p}
              </button>
            )
          )}
          <button
            type="button"
            className="pagerBtn"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            <IconChevronRight />
          </button>
        </nav>
      )}
    </div>
  );
}
