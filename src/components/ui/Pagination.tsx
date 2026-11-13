"use client";

import Box from "@mui/material/Box";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import MuiPagination from "@mui/material/Pagination";

const PAGE_SIZES = [10, 15, 25, 50, 100];

/**
 * Modernized Pagination built on Material UI Pagination and Select.
 * Preserves Indian number formatting, rows-per-page selection, and pagination windowing.
 */
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
    <Box
      className="tableFooter"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 1.5,
        p: 1.5,
        borderTop: "1px solid",
        borderColor: "divider",
        bgcolor: "var(--surface, #ffffff)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.8125rem", display: { xs: "none", sm: "inline" } }}>
          Rows per page
        </Typography>
        <Select
          id="pager-size"
          size="small"
          value={pageSize}
          onChange={(e) => {
            onPageSize(Number(e.target.value));
            onPage(1);
          }}
          sx={{ height: 28, fontSize: "0.8125rem", borderRadius: "4px" }}
        >
          {PAGE_SIZES.map((n) => (
            <MenuItem key={n} value={n} sx={{ fontSize: "0.8125rem" }}>
              {n}
            </MenuItem>
          ))}
        </Select>
        <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.8125rem" }}>
          {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
        </Typography>
      </Box>

      {totalPages > 1 && (
        <MuiPagination
          count={totalPages}
          page={page}
          onChange={(_, p) => onPage(p)}
          size="small"
          color="primary"
          shape="rounded"
          showFirstButton
          showLastButton
        />
      )}
    </Box>
  );
}
