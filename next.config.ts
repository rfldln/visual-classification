import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "500mb" },
  },
  // Keep ffmpeg/ffprobe binaries outside the webpack bundle so their `.path`
  // points at node_modules at runtime instead of .next/vendor-chunks.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
};

export default nextConfig;

