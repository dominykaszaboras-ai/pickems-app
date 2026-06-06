/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
    // The hltv scraper transitively depends on `header-generator` and
    // `got-scraping`, which load sibling JSON data files at import time
    // (e.g. data_files/headers-order.json). If webpack bundles those packages
    // into the API-route output, the data files are left behind and the route
    // crashes on import with ENOENT during `next build` -> "Collecting page
    // data". Externalising these packages keeps them as plain require()s
    // resolved from node_modules at runtime, where the data files actually live.
    serverComponentsExternalPackages: [
      "hltv",
      "got-scraping",
      "header-generator",
    ],
  },
  // Belt-and-braces: same externalisation for any server webpack pass
  // (API routes, server components, etc.) regardless of Next.js version.
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      externals.push({ hltv: "commonjs hltv", "got-scraping": "commonjs got-scraping", "header-generator": "commonjs header-generator" });
      config.externals = externals;
    }
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img-cdn.hltv.org" },
      { protocol: "https", hostname: "static.hltv.org" },
    ],
  },
};

export default nextConfig;
