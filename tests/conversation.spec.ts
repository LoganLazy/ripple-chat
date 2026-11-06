import { test, expect } from "@playwright/test";
import { mockMatrix, connectMatrix } from "./matrix-fixture";

test("输入状态来自真实同步，过滤自己，停止后消失且不产生聊天消息", async ({
  page,
}) => {
  const server = await mockMatrix(page);
  await page.goto("/");
  await connectMatrix(page);
  server.typing(["@friend:matrix.test", "@ripple:matrix.test"]);
  await expect(page.locator(".typing-indicator")).toHaveText("好友 正在输入…");
  await expect(page.locator(".message")).toHaveCount(3);
  server.typing([]);
  await expect(page.locator(".typing-indicator")).toHaveCount(0);
});

test("输入状态限频，闲置停止，切换会话不会把草稿当作正在输入", async ({
  page,
}) => {
  const server = await mockMatrix(page);
  await page.goto("/");
  await connectMatrix(page);
  const input = page.getByRole("textbox", { name: "输入消息" });
  await input.fill("正在写草稿");
  await expect.poll(() => server.typingRequests.length).toBe(1);
  await input.pressSequentially("还在写");
  expect(server.typingRequests).toEqual([
    { room: server.primary, typing: true, timeout: 15000 },
  ]);
  // The idle timer is part of the feature, so verify its real expiry.
  await expect
    .poll(() => server.typingRequests.at(-1)?.typing, { timeout: 7000 })
    .toBe(false);
  await input.fill("继续写");
  await expect
    .poll(() => server.typingRequests.filter((r) => r.typing).length)
    .toBe(2);
  await page.locator(".room-item").filter({ hasText: "另一个房间" }).click();
  await expect.poll(() => server.typingRequests.at(-1)?.typing).toBe(false);
  await page.locator(".room-item").filter({ hasText: "当前房间" }).click();
  await expect(input).toHaveValue("继续写");
  expect(server.typingRequests.filter((r) => r.typing)).toHaveLength(2);
});

test("阅读历史时保留位置并计数新消息，回到最新后清零", async ({ page }) => {
  const server = await mockMatrix(page, 30);
  await page.goto("/");
  await connectMatrix(page);
  await page.locator(".messages").evaluate((el) => {
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect(
    page.getByRole("button", { name: "回到最新消息", exact: true }),
  ).toBeVisible();
  server.push("新来的第一条");
  server.push("新来的第二条");
  await expect(
    page.getByRole("button", { name: "2 条新消息 · 回到最新", exact: true }),
  ).toBeVisible();
  expect(
    await page.locator(".messages").evaluate((el) => el.scrollTop),
  ).toBeLessThan(10);
  await page
    .getByRole("button", { name: "2 条新消息 · 回到最新", exact: true })
    .click();
  await expect(page.locator(".jump-latest")).toHaveCount(0);
  expect(
    await page
      .locator(".messages")
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
  ).toBeLessThan(40);
  await expect.poll(() => server.receipts.at(-1)).toContain("$incoming");
});

test("搜索结果中的引用可定位原文，缺失原文给出提示", async ({ page }) => {
  const server = await mockMatrix(page, 30);
  await page.goto("/");
  await connectMatrix(page);
  server.push("回复最早消息", server.primary, {
    msgtype: "m.text",
    body: "回复最早消息",
    "m.relates_to": { "m.in_reply_to": { event_id: "$0-0" } },
  });
  await page.getByRole("button", { name: "搜索消息", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索当前消息" })
    .fill("回复最早消息");
  await page.getByRole("button", { name: "定位引用消息" }).click();
  await expect(page.getByRole("textbox", { name: "搜索当前消息" })).toHaveValue(
    "",
  );
  await expect(page.locator(".message-highlight")).toContainText("消息 0-0");
  expect(
    await page.locator(".messages").evaluate((el) => el.scrollTop),
  ).toBeLessThan(100);
  server.push("找不到的引用", server.primary, {
    msgtype: "m.text",
    body: "找不到的引用",
    "m.relates_to": { "m.in_reply_to": { event_id: "$missing" } },
  });
  await page
    .locator(".message")
    .filter({ hasText: "找不到的引用" })
    .getByRole("button", { name: "定位引用消息" })
    .click();
  await expect(page.getByRole("status")).toContainText("原消息尚未加载");
});

test("本地附件保存期间取消会中止事务，保留附件供重新发送", async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.transaction.db.name === "ripple-attachments") {
        (window as any).savingAttachment = true;
        const hold = () => {
          const next = this.get("__hold_transaction");
          next.onsuccess = () => {
            if (!(window as any).releaseAttachment) hold();
          };
        };
        hold();
      }
      return request;
    };
  });
  await page.goto("/");
  await page
    .getByLabel("添加附件")
    .setInputFiles({
      name: "cancel.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("cancel me"),
    });
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).savingAttachment))
    .toBe(true);
  await page.getByRole("button", { name: "取消上传", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeEnabled();
  await expect(
    page.locator(".message").filter({ hasText: "cancel.txt" }),
  ).toHaveCount(0);
  await expect(page.locator(".attachment-staging")).toContainText("cancel.txt");
  await page.evaluate(() => {
    (window as any).releaseAttachment = true;
  });
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.locator(".message").filter({ hasText: "cancel.txt" }),
  ).toHaveCount(1);
  const keys = await page.evaluate(
    () =>
      new Promise<IDBValidKey[]>((resolve) => {
        const open = indexedDB.open("ripple-attachments");
        open.onsuccess = () => {
          const request = open.result
            .transaction("files")
            .objectStore("files")
            .getAllKeys();
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
        };
      }),
  );
  expect(keys).toHaveLength(1);
});

test("手机深色模式下输入状态与新消息入口不溢出且可以返回最新", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    localStorage.setItem("ripple-theme", '"dark"'),
  );
  const server = await mockMatrix(page, 30);
  await page.goto("/");
  await connectMatrix(page);
  await page.locator(".room-item").filter({ hasText: "当前房间" }).click();
  await page.locator(".messages").evaluate((el) => {
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  server.typing(["@friend:matrix.test"]);
  server.push("新消息在这里");
  await expect(page.locator(".typing-indicator")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1 条新消息 · 回到最新", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "docs/ripple-v03-mobile.png" });
  await page.locator(".jump-latest").click();
  await expect(page.locator(".jump-latest")).toHaveCount(0);
});
