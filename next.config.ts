import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "**.cdninstagram.com" }, { protocol: "https", hostname: "**.fbcdn.net" }] },
};

export default nextConfig;
