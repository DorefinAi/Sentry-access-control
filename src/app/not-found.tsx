"use client";

import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";

export default function NotFound() {
  return (
    <Box sx={{ py: 6 }}>
      <Typography component="h1" sx={{ fontSize: "1.5rem", fontWeight: 700, mb: 1 }}>
        Nothing at this address
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The link may be old, or the item was removed. Start from Status.
      </Typography>
      <Button component={Link} href="/" variant="contained">
        Go to Status
      </Button>
    </Box>
  );
}
