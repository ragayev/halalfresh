import { defineConfig } from "@playwright/test";

const PORT = 3100;
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/de`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: "postgresql://raghayev@localhost:5432/halalfresh_test",
      NEXT_DIST_DIR: ".next-e2e",
      PAYMENT_PROVIDER: "mock",
      NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
      AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-12345",
    },
  },
});
