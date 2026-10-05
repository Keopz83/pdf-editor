import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  use: {
    baseURL: "http://localhost:8765",
    // Installed Google Chrome; the bundled Chromium can't be downloaded through the corporate proxy.
    channel: "chrome",
  },
  webServer: {
    command: "python3 -m http.server 8765",
    url: "http://localhost:8765",
    reuseExistingServer: !process.env.CI,
  },
});
