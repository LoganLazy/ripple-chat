import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withExtraLibraryPaths, fontconfigFile } from "./launch-env";
import { docScreenshotPath } from "./screenshot-path";

// Electron 的 zygote 进程拒绝以 root 身份运行。以 root 运行时测试会加
// --no-sandbox 和 --disable-setuid-sandbox，打不开窗口时再用
// --single-process 绕过 zygote 重试一次。注意：这些参数只用于测试启动，
// 生产代码仍开启 renderer sandbox，本测试不验证系统级沙箱的隔离效果。
//
// 2026-11-07 在本机（root + Xvfb）实测：两种尝试都打不开窗口 ——
// Electron 45 的 network-service / GPU 子进程在自己的命令行里看不到
// --no-sandbox，仍以 FATAL "Running as root without --no-sandbox"
// 循环退出（ELECTRON_DISABLE_SANDBOX=1 和 --no-zygote 也一样）；
// --single-process 则立即 SIGTRAP。断言未因此放宽，测试仍会如实失败。
// 同一台机器以非 root 用户（nobody）+ --no-sandbox --no-zygote 实测可
// 正常启动并持续运行（需先把 chrome-sandbox 设为 4755，且本机容器禁了
// 非特权 user namespace，所以默认沙箱也起不来）。在普通非 root 桌面上
// 本测试按原有方式运行。
const isRoot = process.getuid?.() === 0;

async function launchElectron(profile: string, extraArgs: string[]) {
  return electron.launch({
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
      ...(isRoot ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
      ...extraArgs,
    ],
    env: {
      ...process.env,
      // 只使用本机实际存在的字体/库路径（可用 RIPPLE_FONTCONFIG_FILE /
      // RIPPLE_GUILIBS 覆盖），不再写死作者机器的路径。
      FONTCONFIG_FILE: fontconfigFile(),
      LD_LIBRARY_PATH: withExtraLibraryPaths(process.env.LD_LIBRARY_PATH),
    },
    timeout: 30000,
  });
}

test("Electron 桌面窗口、自定义协议与渲染隔离", async () => {
  // 两次启动尝试（正常参数 + --single-process）各需一次 firstWindow 等待，
  // 超出默认 45s 的单测超时。
  test.setTimeout(150000);
  test.skip(
    process.platform === "linux" && !process.env.DISPLAY,
    "Linux 桌面测试需要 DISPLAY / Xvfb；以 root 运行时还需 --no-sandbox（见本文件顶部注释），若本机无桌面运行时窗口仍可能打不开",
  );
  const profile = mkdtempSync(path.join(tmpdir(), "ripple-desktop-test-"));
  let app = await launchElectron(profile, []);
  let page;
  try {
    page = await app.firstWindow({ timeout: 30000 });
  } catch (firstError) {
    // 以 root 运行时 zygote 可能仍拒绝启动；改用 --single-process 再试一次。
    await app.close().catch(() => {});
    if (!isRoot) {
      throw firstError;
    }
    app = await launchElectron(profile, ["--single-process"]);
    page = await app.firstWindow({ timeout: 30000 });
  }
  try {
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
    await page.screenshot({ path: docScreenshotPath("ripple-desktop.png") });
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
