import type { NextConfig } from "next";

// Razorpay Checkout.js is only allowed when that provider is switched on.
const rzp = process.env.PAYMENT_PROVIDER === "razorpay";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native module; keep it out of the bundler.
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Owner themes are structured data rendered by React. No owner-supplied
          // markup or scripts ever reach the DOM, and CSP is the backstop.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js dev/prod runtime needs inline+eval for its bootstrap.
              process.env.NODE_ENV === "production"
                ? `script-src 'self' 'unsafe-inline'${rzp ? " https://checkout.razorpay.com" : ""}`
                : `script-src 'self' 'unsafe-inline' 'unsafe-eval'${rzp ? " https://checkout.razorpay.com" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "media-src 'self' blob: https:",
              "font-src 'self' data:",
              `connect-src 'self'${rzp ? " https://api.razorpay.com https://lumberjack.razorpay.com" : ""}`,
              // Only vetted embed providers may be framed.
              `frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com${rzp ? " https://api.razorpay.com https://checkout.razorpay.com" : ""}`,
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
