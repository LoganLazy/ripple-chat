import { test, expect } from "@playwright/test";

test("演示消息、回复、搜索、持久化和独立草稿", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "设计漫游指南", exact: true }).first(),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".messages").evaluate((el) => {
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
  });
  await page.screenshot({ path: "docs/ripple-light.png", fullPage: true });
  await page.getByRole("textbox", { name: "输入消息" }).fill("你好，涟漪！");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.locator(".bubble").filter({ hasText: "你好，涟漪！" }),
  ).toHaveCount(1);
  await page.getByRole("textbox", { name: "输入消息" }).fill("房间独立草稿");
  await page.locator(".room-item").filter({ hasText: "周末咖啡馆" }).click();
  await expect(page.getByRole("textbox", { name: "输入消息" })).toHaveValue("");
  await page.locator(".room-item").filter({ hasText: "设计漫游指南" }).click();
  await expect(page.getByRole("textbox", { name: "输入消息" })).toHaveValue(
    "房间独立草稿",
  );
  await page.locator(".message").first().hover();
  await page.getByRole("button", { name: "回复 林间", exact: true }).click();
  await page.getByRole("textbox", { name: "输入消息" }).fill("赞同这个想法");
  await page.getByRole("textbox", { name: "输入消息" }).press("Enter");
  await expect(page.locator(".quoted-message")).toHaveCount(1);
  await page.getByRole("button", { name: "搜索消息", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索当前消息" }).fill("赞同");
  await expect(page.locator(".message")).toHaveCount(1);
  await page.reload();
  await expect(
    page.locator(".bubble").filter({ hasText: "你好，涟漪！" }),
  ).toHaveCount(1);
  await expect(page.locator(".quoted-message")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("创建房间、表情、空消息、未读过滤与主题", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page.getByLabel("房间名称").fill("测试小宇宙");
  await page.getByLabel("房间介绍").fill("一切从你好开始。");
  await page
    .locator("form")
    .getByRole("button", { name: "创建房间", exact: true })
    .last()
    .click();
  await expect(page.locator(".chat-title h2")).toHaveText("测试小宇宙");
  await page.getByRole("button", { name: "选择表情" }).click();
  await page.getByRole("button", { name: "🌿", exact: true }).click();
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".bubble")).toHaveText("🌿");
  await page.getByRole("textbox", { name: "搜索会话" }).fill("不存在的房间");
  await expect(page.getByText("没有找到匹配的会话")).toBeVisible();
  await page.getByRole("textbox", { name: "搜索会话" }).fill("");
  await page.getByRole("button", { name: /^未读/ }).click();
  await expect(page.locator(".room-item")).toHaveCount(2);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "全部会话", exact: true })
    .first()
    .click();
  await page.locator(".room-item").filter({ hasText: "设计漫游指南" }).click();
  await expect(page.locator(".chat-title h2")).toHaveText("设计漫游指南");
  await page.evaluate(() => document.fonts.ready);
  if (await page.getByRole("button", { name: "关闭提示" }).isVisible())
    await page.getByRole("button", { name: "关闭提示" }).click();
  await page.screenshot({ path: "docs/ripple-dark.png", fullPage: true });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("手机布局可切换会话、发送与返回，无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".chat-main")).toBeHidden();
  await page.locator(".room-item").filter({ hasText: "设计漫游指南" }).click();
  await expect(page.locator(".chat-main")).toBeVisible();
  await page.getByRole("textbox", { name: "输入消息" }).fill("手机也可以聊天");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.locator(".bubble").filter({ hasText: "手机也可以聊天" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "docs/ripple-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "返回会话" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
});

test("登录校验、服务端错误和密码不持久化", async ({ page }) => {
  await page.goto("/");
  await page.locator(".connect-card").click();
  await page.getByLabel("服务器地址").fill("http://unsafe.example");
  await page.getByLabel("Matrix 账号").fill("@test:example");
  await page.getByLabel("密码", { exact: true }).fill("never-store-this");
  await page.getByRole("button", { name: "连接 Matrix", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("HTTPS");
  await page.route("https://matrix.test/**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { flows: [{ type: "m.login.password" }] } });
    return route.fulfill({
      status: 403,
      json: { errcode: "M_FORBIDDEN", error: "Invalid password" },
    });
  });
  await page.getByLabel("服务器地址").fill("https://matrix.test");
  await page.getByRole("button", { name: "连接 Matrix", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("账号或密码不正确");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "never-store-this",
  );
});
