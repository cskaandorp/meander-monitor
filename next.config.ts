import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Uploads arrive as server-action bodies. 100mb matches the storage
    // service's FILE_SIZE_LIMIT and nginx's client_max_body_size on both
    // vhosts — one number governs the whole path, so a file that clears the
    // proxy is never rejected later.
    serverActions: {
      bodySizeLimit: "100mb",
    },
    proxyClientMaxBodySize: "100mb",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "mm-supa.compunist.nl",
      },
    ],
  },
};

export default nextConfig;
