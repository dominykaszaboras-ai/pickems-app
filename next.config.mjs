/** @type {import('next').NextConfig} */

// App-wide security response headers. Applied to every route via the
// `headers()` config below.
//
// We intentionally do NOT set Content-Security-Policy here — Next.js's
// HMR + inline scripts make a strict CSP painful, and the win is small for
// an app that doesn't take user-supplied HTML. Revisit if we ever embed
// rich-text content from users.
const SECURITY_HEADERS = [
  // Block render in <iframe> on other sites (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  // Disable MIME-type sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs (including query strings) to third-party origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Drop powerful browser features we don't use.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Force HTTPS for a year (Railway already serves over HTTPS).
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig = {
  experimental: {
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
