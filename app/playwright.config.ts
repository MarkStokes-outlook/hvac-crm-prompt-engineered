import { defineConfig } from "@playwright/test";

// E2E runs against a throwaway database so it never touches your demo data.
const env = { FROSTLINE_DATA_DIR: "./data/e2e", PORT: "3101", FROSTLINE_AI: "off" };
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: "http://localhost:3101", trace: "retain-on-failure" },
  webServer: {
    command: "npx vite build && npx tsx server/reset.ts && npx tsx server/index.ts --serve-client",
    url: "http://localhost:3101/api/health",
    reuseExistingServer: false,
    env,
    timeout: 120_000,
  },
});
