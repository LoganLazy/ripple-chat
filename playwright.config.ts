import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: "npm run preview",
    url: "http://127.0.0.1:5188",
    reuseExistingServer: true,
    timeout: 30000,
  },
  use: {
    baseURL: "http://127.0.0.1:5188",
    viewport: { width: 1440, height: 960 },
    headless: true,
    launchOptions: process.env.RIPPLE_CHROME
      ? {
          executablePath: process.env.RIPPLE_CHROME,
          env: {
            ...process.env,
            LD_LIBRARY_PATH: [
              process.env.LD_LIBRARY_PATH,
              "/home/lazyease/nebula-memory/guilibs/root/usr/lib/x86_64-linux-gnu",
            ]
              .filter(Boolean)
              .join(":"),
          },
        }
      : {},
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
