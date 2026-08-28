import type { NextConfig } from "next";

// Same-origin proxy for browser REST: apiFetch() calls /api/* on the
// dashboard's own origin so the session cookie (SameSite=Lax, set by
// the API with no Domain attribute) stays first-party. API_ORIGIN is
// the deployed API's absolute origin; unset locally, where apiFetch
// talks to NEXT_PUBLIC_API_URL directly and this rewrite is inert.
const apiOrigin = process.env.API_ORIGIN;

const nextConfig: NextConfig = {
  async rewrites() {
    return apiOrigin
      ? [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }]
      : [];
  },
};

export default nextConfig;
