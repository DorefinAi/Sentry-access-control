"use client";

// A button that knows the signed-in role. When the role cannot do the action the
// button stays visible but disabled, with a short tooltip saying why, so a viewer
// learns what exists without being able to change it.
import { Box, Button, ButtonProps, Tooltip } from "@mui/material";
import { useCan } from "@/providers/SessionProvider";
import type { Action } from "@/lib/roles";

// `need` names the permission; MUI already uses `action` on buttons
export function GuardedButton({ need, disabled, ...props }: ButtonProps & { need: Action }) {
  const { allowed, reason } = useCan(need);
  if (allowed) return <Button disabled={disabled} {...props} />;
  return (
    <Tooltip title={reason}>
      {/* Disabled buttons fire no events, so the tooltip hangs on a wrapper */}
      <Box component="span" tabIndex={0} aria-label={`${typeof props.children === "string" ? props.children : "Action"} (not available: ${reason})`} sx={{ display: "inline-flex", borderRadius: "6px" }}>
        <Button {...props} disabled aria-hidden />
      </Box>
    </Tooltip>
  );
}
