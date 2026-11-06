import { test, expect } from "@playwright/test";
import { mockMatrix, connectMatrix } from "./matrix-fixture";

test("损坏的本地偏好与演示数据不会导致白屏", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ripple-pins", "{}");
    localStorage.setItem("ripple-theme", "42");
    localStorage.setItem("ripple-demo", '[{"members":[],"messages":[null]}]');
  });
  await page.goto("/");
  await expect(page.locator(".chat-title h2")).toHaveText("设计漫游指南");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
test("存储写入被拒绝时仍能切换主题并聊天", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("denied", "QuotaExceededError");
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.getByRole("textbox", { name: "输入消息" }).fill("还能继续聊天");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.locator(".bubble").filter({ hasText: "还能继续聊天" }),
  ).toHaveCount(1);
});
test("连接账号和退出账号清空附件、引用、搜索和草稿", async ({ page }) => {
  await mockMatrix(page);
  await page.goto("/");
  await page.getByLabel("添加附件").setInputFiles({
    name: "private.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("private"),
  });
  await page.getByRole("textbox", { name: "输入消息" }).fill("本地草稿");
  await connectMatrix(page);
  await expect(page.locator(".attachment-staging")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "输入消息" })).toHaveValue("");
  await page.locator(".message").first().hover();
  await page.getByRole("button", { name: "回复 好友" }).first().click();
  await page.getByRole("textbox", { name: "输入消息" }).fill("账号私密草稿");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "退出账号" }).click();
  await expect(page.locator(".reply-preview")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "输入消息" })).toHaveValue("");
});
test("自动选中的会话不会被其他房间的新消息切换", async ({ page }) => {
  const server = await mockMatrix(page);
  await page.goto("/");
  await connectMatrix(page);
  await page.getByRole("textbox", { name: "输入消息" }).fill("正在写的草稿");
  server.push("另一个房间来了新消息", server.secondary);
  await expect(
    page.locator(".room-item").filter({ hasText: "另一个房间来了新消息" }),
  ).toHaveCount(1);
  await expect(page.locator(".chat-title h2")).toHaveText("当前房间");
  await expect(page.getByRole("textbox", { name: "输入消息" })).toHaveValue(
    "正在写的草稿",
  );
});
test("手机停留在会话列表时不发送已读回执", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const server = await mockMatrix(page);
  await page.goto("/");
  await connectMatrix(page);
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.waitForTimeout(400);
  expect(server.receipts).toHaveLength(0);
  await page.locator(".room-item").filter({ hasText: "当前房间" }).click();
  await expect.poll(() => server.receipts.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "返回会话" }).click();
  const count = server.receipts.length;
  server.push("还没有打开阅读");
  await expect(
    page.locator(".room-item").filter({ hasText: "还没有打开阅读" }),
  ).toHaveCount(1);
  expect(server.receipts).toHaveLength(count);
});
test("发送失败只保留一份待重试消息，重试沿用事务 ID", async ({ page }) => {
  const server = await mockMatrix(page);
  await page.goto("/");
  await connectMatrix(page);
  server.failNextSend();
  await page.getByRole("textbox", { name: "输入消息" }).fill("失败的消息");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const failed = page.locator(".message.own").filter({ hasText: "失败的消息" });
  await expect(failed.getByRole("button", { name: /发送失败/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "输入消息" })).toHaveValue("");
  await failed.getByRole("button", { name: /发送失败/ }).click();
  await expect(failed.locator(".delivery")).toHaveText("已发送");
  expect(server.sends).toHaveLength(2);
  expect(server.sends[0].txn).toBe(server.sends[1].txn);
  await expect(failed).toHaveCount(1);
});
test("编辑失败后可重试，不阻塞后续发送", async ({ page }) => {
  const server = await mockMatrix(page);
  await page.goto("/");
  await connectMatrix(page);
  await page.getByRole("textbox", { name: "输入消息" }).fill("原消息");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const own = page.locator(".message.own").filter({ hasText: "原消息" });
  await expect(own.locator(".delivery")).toHaveText("已发送");
  await own.hover();
  await own.getByRole("button", { name: "编辑消息" }).click();
  server.failNextEdit();
  await page.getByLabel("消息内容").fill("修改后的内容");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog", { name: "编辑消息" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "输入消息" }).fill("编辑后的下一条");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page
      .locator(".message.own")
      .filter({ hasText: "编辑后的下一条" })
      .locator(".delivery"),
  ).toHaveText("已发送");
});
test("历史消息加载保持阅读锚点", async ({ page }) => {
  await mockMatrix(page, 25);
  await page.goto("/");
  await connectMatrix(page);
  const panel = page.locator(".messages");
  await panel.evaluate((el) => {
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
  });
  const anchor = page.locator(".message").first();
  const before = await anchor.boundingBox();
  await page.getByRole("button", { name: "加载更早的消息" }).click();
  await expect(
    page.locator(".message").filter({ hasText: "历史消息 0" }),
  ).toHaveCount(1);
  const after = await page
    .locator(".message")
    .filter({ hasText: "消息 0-0" })
    .boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(8);
});

test("阅读历史期间不误报新消息已读，回到底部才确认", async ({ page }) => {
  const server = await mockMatrix(page, 30);
  await page.goto("/");
  await connectMatrix(page);
  await expect.poll(() => server.receipts.length).toBeGreaterThan(0);
  await page.locator(".messages").evaluate((el) => {
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  const previous = server.receipts.length;
  server.push("暂时还没有读到的新消息");
  await expect(
    page.locator(".room-item").filter({ hasText: "暂时还没有读到的新消息" }),
  ).toHaveCount(1);
  expect(server.receipts).toHaveLength(previous);
  await page.locator(".messages").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(() => server.receipts.length).toBe(previous + 1);
});
test("失败消息可以取消且不会再次发送", async ({ page }) => {
  const server = await mockMatrix(page);
  await page.goto("/");
  await connectMatrix(page);
  server.failNextSend();
  await page.getByRole("textbox", { name: "输入消息" }).fill("取消这条");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "取消失败消息" }).click();
  await expect(page.locator(".message.own")).toHaveCount(0);
  await page.getByRole("textbox", { name: "输入消息" }).fill("下一条正常消息");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".message.own .delivery")).toHaveText("已发送");
  expect(server.sends.map((s) => s.content.body)).toEqual([
    "取消这条",
    "下一条正常消息",
  ]);
});
test("旧客户端回复不重复展示引用，引用以原消息为准", async ({ page }) => {
  const server = await mockMatrix(page);
  await page.goto("/");
  await connectMatrix(page);
  server.push("", server.primary, {
    msgtype: "m.text",
    body: "> <@friend:matrix.test> 这段伪造引用不应该显示\n> 旧客户端附带引用\n\n真正的回复正文",
    "m.relates_to": { "m.in_reply_to": { event_id: "$0-2" } },
  });
  const reply = page.locator(".message").filter({ hasText: "真正的回复正文" });
  await expect(reply.locator(".quoted-message")).toHaveText("消息 0-2");
  await expect(reply.locator(".bubble p")).toHaveText("真正的回复正文");
  await expect(page.getByText("这段伪造引用不应该显示")).toHaveCount(0);
});
test("远端修改附件后下载新内容，不复用旧文件缓存", async ({ page }) => {
  const server = await mockMatrix(page);
  await page.route(
    "https://matrix.test/_matrix/client/v1/media/download/**",
    (route) =>
      route.fulfill({
        body: route.request().url().includes("second")
          ? "new-file-content"
          : "old-file-content",
        contentType: "text/plain",
      }),
  );
  await page.goto("/");
  await connectMatrix(page);
  const original = {
    msgtype: "m.file",
    body: "file.txt",
    filename: "file.txt",
    url: "mxc://matrix.test/first",
    info: { mimetype: "text/plain", size: 16 },
  };
  const id = server.push("", server.primary, original);
  const file = page.locator(".message").filter({ hasText: "file.txt" });
  await expect(file.locator(".file-card")).toBeVisible();
  async function contents() {
    const wait = page.waitForEvent("download");
    await file.getByRole("button", { name: "下载附件" }).click();
    const downloaded = await wait;
    const stream = await downloaded.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk);
    return Buffer.concat(chunks).toString();
  }
  expect(await contents()).toBe("old-file-content");
  server.push("", server.primary, {
    msgtype: "m.file",
    body: "* file.txt",
    "m.new_content": { ...original, url: "mxc://matrix.test/second" },
    "m.relates_to": { rel_type: "m.replace", event_id: id },
  });
  await expect(file.locator(".edited-label")).toBeVisible();
  expect(await contents()).toBe("new-file-content");
});

test("局域网 HTTP 环境可演示发消息和复制，真实登录提示安全环境", async ({
  page,
}) => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  await page.route("http://ripple.test/**", async (route) => {
    const file = new URL(route.request().url()).pathname;
    const extension = path.extname(file);
    const types: Record<string, string> = {
      ".js": "application/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".wasm": "application/wasm",
    };
    await route.fulfill({
      body: await readFile(
        path.resolve("dist", "." + (file === "/" ? "/index.html" : file)),
      ),
      contentType: types[extension] || "text/html",
    });
  });
  await page.goto("http://ripple.test");
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  await page.getByRole("textbox", { name: "输入消息" }).fill("HTTP 也能演示");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const message = page
    .locator(".message.own")
    .filter({ hasText: "HTTP 也能演示" });
  await expect(message).toHaveCount(1);
  await page.evaluate(() => {
    document.execCommand = () => {
      (window as any).copiedValue = (
        document.activeElement as HTMLTextAreaElement
      ).value;
      return true;
    };
  });
  await message.hover();
  await message.getByRole("button", { name: "复制消息" }).click();
  expect(await page.evaluate(() => (window as any).copiedValue)).toBe(
    "HTTP 也能演示",
  );
  await page.locator(".connect-card").click();
  await page.getByLabel("Matrix 账号").fill("@test:matrix.test");
  await page.getByLabel("密码", { exact: true }).fill("test");
  await page.getByRole("button", { name: "连接 Matrix", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("需要安全环境");
});
