import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Other lockfiles exist higher up the tree; pin the workspace root to this app.
  turbopack: { root: __dirname },
  // NEXT_DIST_DIR=.next-alt lets a second dev server run beside the main one
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
