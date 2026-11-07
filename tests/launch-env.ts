import { existsSync } from "node:fs";

/**
 * Extra native library directories for Chromium / Electron launches.
 *
 * Only paths that actually exist on this machine are returned, so a test
 * checkout works on any machine without author-specific paths. Override
 * with RIPPLE_GUILIBS (colon-separated). The /tmp candidate below is the
 * local fallback this repo's own verification record used for a broken
 * system GTK install; it is ignored when it does not exist.
 */
export function extraLibraryPaths(): string[] {
  const fromEnv = (process.env.RIPPLE_GUILIBS ?? "")
    .split(":")
    .map((p) => p.trim())
    .filter(Boolean);
  const candidates = [
    ...fromEnv,
    "/tmp/ripple-runtime/root/usr/lib/x86_64-linux-gnu",
  ];
  return candidates.filter((p) => existsSync(p));
}

/** Join the extra library paths into the existing LD_LIBRARY_PATH. */
export function withExtraLibraryPaths(existing?: string): string {
  return [...extraLibraryPaths(), existing].filter(Boolean).join(":");
}

/**
 * Fontconfig file for Chromium / Electron launches, if one is available.
 * Override with RIPPLE_FONTCONFIG_FILE; otherwise keep any value already
 * in the environment, else the local /tmp fallback when it exists.
 */
export function fontconfigFile(): string {
  if (process.env.RIPPLE_FONTCONFIG_FILE) {
    return process.env.RIPPLE_FONTCONFIG_FILE;
  }
  if (process.env.FONTCONFIG_FILE) {
    return process.env.FONTCONFIG_FILE;
  }
  return existsSync("/tmp/trunk-fonts.conf") ? "/tmp/trunk-fonts.conf" : "";
}
