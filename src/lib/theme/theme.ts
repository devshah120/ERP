"use client";

import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0a7bbf",
      light: "#e7f3fb",
      dark: "#0868a3",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#64748b",
      light: "#94a3b8",
      dark: "#475569",
      contrastText: "#ffffff",
    },
    success: {
      main: "#15803d",
      light: "#ecfdf3",
      dark: "#14532d",
      contrastText: "#ffffff",
    },
    warning: {
      main: "#b45309",
      light: "#fdf9ec",
      dark: "#78350f",
      contrastText: "#ffffff",
    },
    error: {
      main: "#dc2626",
      light: "#fdf3f3",
      dark: "#991b1b",
      contrastText: "#ffffff",
    },
    info: {
      main: "#0284c7",
      light: "#e7f3fb",
      dark: "#0369a1",
      contrastText: "#ffffff",
    },
    background: {
      default: "#f2f7fb",
      paper: "#ffffff",
    },
    text: {
      primary: "#111827",
      secondary: "#64748b",
    },
    divider: "#e5e7eb",
  },
  typography: {
    fontFamily: 'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    button: {
      textTransform: "none",
      fontWeight: 500,
    },
    body1: {
      fontSize: "0.875rem",
    },
    body2: {
      fontSize: "0.8125rem",
    },
  },
  shape: {
    borderRadius: 6,
  },
  components: {
    MuiButton: {
      defaultProps: {
        size: "small",
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 500,
        },
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: "small",
      },
    },
    MuiTextField: {
      defaultProps: {
        size: "small",
      },
    },
    MuiSelect: {
      defaultProps: {
        size: "small",
      },
    },
    MuiChip: {
      defaultProps: {
        size: "small",
      },
      styleOverrides: {
        root: {
          fontWeight: 500,
          borderRadius: 4,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          boxShadow: "0 20px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.1)",
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: "0.8125rem",
          "&:hover": {
            backgroundColor: "#e7f3fb",
            color: "#111827",
            "& .MuiListItemIcon-root": {
              color: "#0a7bbf",
            },
          },
          "&.Mui-selected": {
            backgroundColor: "#e7f3fb",
            color: "#0869a6",
            fontWeight: 600,
            "&:hover": {
              backgroundColor: "#dbebf7",
            },
            "& .MuiListItemIcon-root": {
              color: "#0a7bbf",
            },
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          "&:hover": {
            backgroundColor: "#e7f3fb",
            color: "#111827",
          },
          "&.Mui-selected": {
            backgroundColor: "#e7f3fb",
            color: "#0869a6",
            fontWeight: 600,
            "&:hover": {
              backgroundColor: "#dbebf7",
            },
          },
        },
      },
    },
  },
});

