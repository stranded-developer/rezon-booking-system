import type { NextConfig } from "next";

/**
 * Venue photos are served from Supabase Storage, so Next may resize them.
 * Local Supabase is http on 127.0.0.1:54321; hosted projects are https on *.supabase.co.
 */
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "127.0.0.1", port: "54321", pathname: "/storage/v1/object/public/**" },
      { protocol: "http", hostname: "localhost", port: "54321", pathname: "/storage/v1/object/public/**" },
      { protocol: "https", hostname: "**.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
  },
};

export default nextConfig;
