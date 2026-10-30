"use client";

// Loading, error and empty states in one place so every list handles all three.
import { Box, Button, Skeleton, Typography } from "@mui/material";
import { CircleX } from "lucide-react";
import type { ReactNode } from "react";
import type { ApiState } from "@/hooks/useApi";

export function LoadingRows({ rows = 3, height = 44 }: { rows?: number; height?: number }) {
  return (
    <Box role="status" aria-label="Loading" sx={{ display: "grid", gap: 1 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} variant="rounded" height={height} sx={{ borderRadius: "4px" }} />
      ))}
    </Box>
  );
}

export function ErrorNote({ error, onRetry, what }: { error: Error; onRetry?: () => void; what?: string }) {
  return (
    <Box role="alert" sx={{ display: "flex", gap: 1, alignItems: "flex-start", p: 1.5, border: 1, borderColor: "error.main", borderRadius: "4px" }}>
      <Box sx={{ color: "error.main", display: "flex", pt: "2px" }}>
        <CircleX size={16} aria-hidden />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {what ? `Could not load ${what}` : "Could not load this"}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
          {error.message}
        </Typography>
      </Box>
      {onRetry ? (
        <Button size="small" variant="outlined" onClick={onRetry} sx={{ flexShrink: 0 }}>
          Try again
        </Button>
      ) : null}
    </Box>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ p: 2, border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: "4px", textAlign: "center" }}>
      <Typography variant="body2" color="text.secondary">
        {children}
      </Typography>
    </Box>
  );
}

export function AsyncView<T>({
  state,
  what,
  isEmpty,
  empty,
  loading,
  children,
}: {
  state: ApiState<T>;
  what?: string;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { data, error, reload } = state;
  if (data === undefined) {
    if (error) return <ErrorNote error={error} onRetry={reload} what={what} />;
    return <>{loading ?? <LoadingRows />}</>;
  }
  return (
    <>
      {/* A failed background refresh keeps the last good data and says so */}
      {error ? (
        <Box sx={{ mb: 1 }}>
          <ErrorNote error={error} onRetry={reload} what={what ? `fresh ${what}` : undefined} />
        </Box>
      ) : null}
      {isEmpty?.(data) ? <EmptyNote>{empty ?? "Nothing here."}</EmptyNote> : children(data)}
    </>
  );
}
