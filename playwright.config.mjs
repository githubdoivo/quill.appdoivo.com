import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:4184", trace: "retain-on-failure", acceptDownloads: true },
  webServer: { command: "python3 -m http.server 4184 --bind 127.0.0.1", url: "http://127.0.0.1:4184", reuseExistingServer: !process.env.CI },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } } },
    { name: "iphone", use: { ...devices["iPhone 13"] } },
  ],
});
