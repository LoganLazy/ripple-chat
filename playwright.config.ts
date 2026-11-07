import { defineConfig } from "@playwright/test";
import { withExtraLibraryPaths } from "./tests/launch-env";

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
            // Only library paths that exist on this machine are added;
            // override with RIPPLE_GUILIBS (see tests/launch-env.ts).
            LD_LIBRARY_PATH: withExtraLibraryPaths(process.env.LD_LIBRARY_PATH),
          },
        }
      : {},
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
