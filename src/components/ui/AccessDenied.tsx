"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { IconLock } from "@/components/icons";

/**
 * Shown in place of a screen the signed-in user's role can't open. States the
 * missing permission so an owner knows exactly what to grant.
 */
export default function AccessDenied({ detail }: { detail?: string }) {
  return (
    <Box
      className="statusPage"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        p: 3,
      }}
    >
      <Paper
        className="statusPageInner"
        elevation={0}
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          p: 5,
          maxWidth: 420,
          width: "100%",
          textAlign: "center",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 3,
        }}
      >
        {/* Lock icon badge */}
        <Box
          className="authIconBadge warn"
          sx={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            bgcolor: "warning.light",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "warning.dark",
            "& svg": { width: 32, height: 32 },
          }}
        >
          <IconLock />
        </Box>

        {/* Status code */}
        <Typography
          className="statusCode"
          variant="overline"
          sx={{ color: "warning.main", fontWeight: 700, letterSpacing: 2 }}
        >
          403 · NO ACCESS
        </Typography>

        {/* Heading */}
        <Typography className="title" variant="h5" sx={{ fontWeight: 700 }}>
          You don&apos;t have access to this
        </Typography>

        {/* Body */}
        <Typography className="subtitle" variant="body2" color="text.secondary">
          Your role doesn&apos;t include permission for this screen. Ask the workspace owner to
          update your role if you need it.
          {detail && (
            <>
              <br />
              <Box
                component="span"
                className="cellMono"
                sx={{ color: "text.disabled", fontFamily: "monospace", fontSize: "0.75rem" }}
              >
                {detail}
              </Box>
            </>
          )}
        </Typography>

        {/* Action */}
        <Box className="statusPageActions" sx={{ mt: 1 }}>
          <Button
            variant="contained"
            component={Link}
            href="/dashboard"
            size="medium"
            disableElevation
          >
            Go to dashboard
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

/** True when an API error means "forbidden" rather than "broken". */
export function isForbidden(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    ((err as { status?: number }).status === 403 || (err as { code?: string }).code === "FORBIDDEN")
  );
}
