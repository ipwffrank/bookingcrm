import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@glowos/ui", "@glowos/types"],
};

export default nextConfig;
