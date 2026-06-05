/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img-cdn.hltv.org" },
      { protocol: "https", hostname: "static.hltv.org" },
    ],
  },
};

export default nextConfig;
