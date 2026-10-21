/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  images: { unoptimized: true },
  // The phone needs to reach the API over the venue LAN, so the base URL is
  // resolved at runtime in src/lib/api.ts rather than baked in at build time.
  /* async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  }, */
};

export default nextConfig;
