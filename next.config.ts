import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Enables next/navigation's forbidden() — a real 403 status from a Server
    // Component/Route Handler, used for EBOARD_ONLY event access and the
    // internal E-Board leaderboard. See src/app/forbidden.tsx.
    authInterrupts: true,
  },
};

export default nextConfig;
