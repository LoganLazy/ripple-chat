import path from "node:path";

/**
 * Where a test screenshot should be written.
 *
 * By default screenshots go to test-results/screenshots/ (gitignored), so
 * running `npm test` never dirties the working tree. Set
 * RIPPLE_UPDATE_DOCS=1 to refresh the committed README previews in docs/.
 */
export function docScreenshotPath(name: string): string {
  return process.env.RIPPLE_UPDATE_DOCS === "1"
    ? path.join("docs", name)
    : path.join("test-results", "screenshots", name);
}
