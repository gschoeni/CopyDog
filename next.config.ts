import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Builds and the dev server must never share an output directory: a
  // `pnpm build` (or `pnpm check` / the e2e webServer) while `pnpm dev`
  // is running would clobber the dev server's Turbopack cache and leave
  // it serving stale chunks. CI/Vercel build with the default `.next`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
