import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("Electron 桌面窗口、自定义协议与渲染隔离", async () => {
  test.skip(
    process.platform === "linux" && !process.env.DISPLAY,
    "Linux 桌面测试需要 DISPLAY / Xvfb",
  );
  const profile = mkdtempSync(path.join(tmpdir(), "ripple-desktop-test-"));
  const app = await electron.launch({
    args: [
      ".",
      `--user-data-dir=${profile}`,
      ...(process.env.RIPPLE_CHROME
        ? [
            "--no-sandbox",
            "--headless",
            "--ozone-platform=headless",
            "--disable-gpu",
          ]
        : []),
    ],
    env: {
      ...process.env,
      FONTCONFIG_FILE: process.env.RIPPLE_CHROME
        ? "/tmp/trunk-fonts.conf"
        : process.env.FONTCONFIG_FILE || "",
      LD_LIBRARY_PATH: process.env.RIPPLE_CHROME
        ? [
            "/tmp/ripple-runtime/root/usr/lib/x86_64-linux-gnu",
            process.env.LD_LIBRARY_PATH,
            "/home/lazyease/nebula-memory/guilibs/root/usr/lib/x86_64-linux-gnu",
          ]
            .filter(Boolean)
            .join(":")
        : process.env.LD_LIBRARY_PATH || "",
    },
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".chat-title h2")).toHaveText("设计漫游指南");
    expect(page.url()).toBe("ripple://app/index.html");
    expect(await page.evaluate(() => typeof (window as any).require)).toBe(
      "undefined",
    );
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    const prefs = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.sandbox).toBe(true);
    await page
      .getByRole("textbox", { name: "输入消息" })
      .fill("来自 Electron 桌面端");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(
      page.locator(".bubble").filter({ hasText: "来自 Electron 桌面端" }),
    ).toHaveCount(1);
    await page.getByLabel("添加附件").setInputFiles({
      name: "desktop.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Electron attachment bytes"),
    });
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const attachment = page
      .locator(".message.own")
      .filter({ hasText: "desktop.txt" });
    await expect(attachment.locator(".file-card")).toBeVisible();
    const saved = path.join(profile, "downloaded.txt");
    await app.evaluate(({ session }, saved) => {
      session.defaultSession.once("will-download", (_event, item) =>
        item.setSavePath(saved),
      );
    }, saved);
    await attachment.getByRole("button", { name: "下载附件" }).click();
    await expect
      .poll(() => (existsSync(saved) ? readFileSync(saved).toString() : ""))
      .toBe("Electron attachment bytes");
    await page.screenshot({ path: "docs/ripple-desktop.png" });
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
