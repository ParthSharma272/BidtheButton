import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { AUTO_APPROVE_CAMPAIGNS: "false", PAYMENT_PROVIDER: "mock", TAX_BPS: "1800", FEE_BPS: "0" },
  },
});
