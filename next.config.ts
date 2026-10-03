import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Schools run this on old office desktops over patchy broadband.
  // Server components by default; resist client-side libraries.
  reactStrictMode: true,
};

export default nextConfig;
