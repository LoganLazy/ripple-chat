import { test, expect } from "@playwright/test";

test("Matrix SDK 实际初始化加密引擎、登录、同步、发消息与退出（模拟服务器）", async ({
  page,
}) => {
  const sent: Record<string, any>[] = [];
  const unexpected: string[] = [];
  let uploaded: Buffer | undefined;
  let mediaAuthorization = "";
  let uploadMode = "ok";
  const user = "@ripple:matrix.test",
    roomId = "!studio:matrix.test";
  let count = 0;
  let eventCounter = 1;
  const pending: any[] = [];
  const state = (type: string, content: any, state_key = "") => ({
    type,
    content,
    state_key,
    sender: user,
    event_id: `$state${eventCounter++}`,
    origin_server_ts: Date.now(),
  });
  await page.route("https://matrix.test/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname);
    const method = request.method();
    const fulfill = (data: any, status = 200) =>
      route.fulfill({ status, json: data });
    if (method === "OPTIONS") return fulfill({});
    if (path.endsWith("/versions"))
      return fulfill({ versions: ["v1.11"], unstable_features: {} });
    if (path.endsWith("/login") && method === "GET")
      return fulfill({ flows: [{ type: "m.login.password" }] });
    if (path.endsWith("/login"))
      return fulfill({
        user_id: user,
        access_token: "test-only-token",
        device_id: "RIPPLE_TEST",
      });
    if (path.endsWith("/account/whoami"))
      return fulfill({ user_id: user, device_id: "RIPPLE_TEST" });
    if (path.endsWith("/capabilities")) return fulfill({ capabilities: {} });
    if (path.endsWith("/pushrules/"))
      return fulfill({
        global: {
          override: [],
          content: [],
          room: [],
          sender: [],
          underride: [],
        },
      });
    if (path.includes("/filter")) return fulfill({ filter_id: "1" });
    if (path.endsWith("/keys/upload"))
      return fulfill({ one_time_key_counts: { signed_curve25519: 50 } });
    if (path.endsWith("/keys/query"))
      return fulfill({ device_keys: {}, failures: {} });
    if (path.endsWith("/keys/changes"))
      return fulfill({ changed: [], left: [] });
    if (path.includes("/room_keys/version"))
      return fulfill({ errcode: "M_NOT_FOUND", error: "No backup" }, 404);
    if (path.endsWith("/sync")) {
      const first = count++ === 0;
      if (!first) await new Promise((resolve) => setTimeout(resolve, 250));
      const timeline = first
        ? [
            {
              type: "m.room.message",
              sender: "@friend:matrix.test",
              event_id: "$hello",
              origin_server_ts: Date.now(),
              content: {
                msgtype: "m.text",
                body: "这是一条来自 Matrix 同步接口的消息。",
              },
            },
          ]
        : pending.splice(0);
      return fulfill({
        next_batch: `s${count}`,
        account_data: { events: [] },
        presence: { events: [] },
        to_device: { events: [] },
        device_lists: { changed: [], left: [] },
        device_one_time_keys_count: { signed_curve25519: 50 },
        rooms: {
          join: {
            [roomId]: {
              state: {
                events: first
                  ? [
                      state("m.room.create", {
                        creator: user,
                        room_version: "10",
                      }),
                      state("m.room.name", { name: "Matrix 测试房间" }),
                      state(
                        "m.room.member",
                        { membership: "join", displayname: "Ripple" },
                        user,
                      ),
                      state(
                        "m.room.member",
                        { membership: "join", displayname: "好友" },
                        "@friend:matrix.test",
                      ),
                      state("m.room.power_levels", { users: { [user]: 100 } }),
                    ]
                  : [],
              },
              timeline: {
                events: timeline,
                limited: false,
                prev_batch: "history",
              },
              ephemeral: { events: [] },
              account_data: { events: [] },
              unread_notifications: {
                notification_count: 0,
                highlight_count: 0,
              },
            },
          },
        },
      });
    }
    if (path.endsWith("/upload")) {
      if (uploadMode === "fail")
        return fulfill(
          { errcode: "M_TOO_LARGE", error: "文件超过服务器限制" },
          413,
        );
      if (uploadMode === "wait") return new Promise<void>(() => {});
      expect(request.headers().authorization).toBe("Bearer test-only-token");
      uploaded = request.postDataBuffer()!;
      return fulfill({ content_uri: "mxc://matrix.test/file1" });
    }
    if (path.includes("/media/download/")) {
      mediaAuthorization = request.headers().authorization;
      return route.fulfill({ body: uploaded!, contentType: "text/plain" });
    }
    if (path.includes("/redact/")) {
      const target = path.split("/redact/")[1].split("/")[0];
      pending.push({
        type: "m.room.redaction",
        sender: user,
        event_id: "$redaction",
        origin_server_ts: Date.now(),
        redacts: target,
        content: { redacts: target },
      });
      return fulfill({ event_id: "$redaction" });
    }
    if (path.includes("/send/m.room.message/")) {
      const content = request.postDataJSON();
      sent.push(content);
      const event_id = `$sent${sent.length}`;
      pending.push({
        type: "m.room.message",
        content,
        sender: user,
        event_id,
        origin_server_ts: Date.now(),
        unsigned: { transaction_id: path.split("/").at(-1) },
      });
      return fulfill({ event_id });
    }
    if (
      path.includes("/receipt/") ||
      path.includes("/typing/") ||
      path.includes("/read_markers") ||
      path.includes("/sendToDevice/") ||
      path.includes("/account_data/")
    )
      return fulfill({});
    if (path.endsWith("/logout")) return fulfill({});
    if (path.endsWith("/members")) return fulfill({ chunk: [] });
    if (path.endsWith("/devices"))
      return fulfill({ devices: [{ device_id: "RIPPLE_TEST" }] });
    unexpected.push(`${method} ${path}`);
    return fulfill({ errcode: "M_UNRECOGNIZED", error: "Not mocked" }, 404);
  });
  await page.goto("/");
  await page.locator(".connect-card").click();
  await page.getByLabel("服务器地址").fill("https://matrix.test");
  await page.getByLabel("Matrix 账号").fill(user);
  await page.getByLabel("密码", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "连接 Matrix", exact: true }).click();
  await expect(page.locator(".chat-title h2")).toHaveText("Matrix 测试房间", {
    timeout: 30000,
  });
  await expect(
    page.locator(".bubble").filter({ hasText: "来自 Matrix 同步接口" }),
  ).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "输入消息" })
    .fill("真实 SDK 发出的消息");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    body: "真实 SDK 发出的消息",
    msgtype: "m.text",
  });
  await expect(
    page.locator(".bubble").filter({ hasText: "真实 SDK 发出的消息" }),
  ).toHaveCount(1);
  const original = page
    .locator(".message.own")
    .filter({ hasText: "真实 SDK 发出的消息" });
  await original.hover();
  await original.getByRole("button", { name: "编辑消息" }).click();
  await page.getByLabel("消息内容").fill("Matrix 修改后的消息");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]["m.relates_to"]).toEqual({
    rel_type: "m.replace",
    event_id: "$sent1",
  });
  expect(sent[1]["m.new_content"].body).toBe("Matrix 修改后的消息");
  const edited = page
    .locator(".message.own")
    .filter({ hasText: "Matrix 修改后的消息" });
  await expect(edited).toHaveCount(1);
  await expect(edited.locator(".edited-label")).toBeVisible();
  await page.getByLabel("添加附件").setInputFiles({
    name: "matrix-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Matrix file bytes"),
  });
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(uploaded?.toString()).toBe("Matrix file bytes");
  expect(sent[2]).toMatchObject({
    msgtype: "m.file",
    url: "mxc://matrix.test/file1",
    filename: "matrix-notes.txt",
  });
  const file = page
    .locator(".message.own")
    .filter({ hasText: "matrix-notes.txt" });
  const downloading = page.waitForEvent("download");
  await file.getByRole("button", { name: "下载附件" }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe("Matrix file bytes");
  expect(mediaAuthorization).toBe("Bearer test-only-token");
  await edited.hover();
  await edited.getByRole("button", { name: "撤回消息" }).click();
  await page.getByRole("button", { name: "确认撤回" }).click();
  await expect(page.locator(".message.redacted")).toHaveCount(1);
  uploadMode = "fail";
  await page.getByLabel("添加附件").setInputFiles({
    name: "retry.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("retry"),
  });
  await page.getByRole("textbox", { name: "输入消息" }).fill("失败后保留草稿");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("服务器限制");
  await expect(page.locator(".attachment-staging")).toContainText("retry.txt");
  await expect(page.getByRole("textbox", { name: "输入消息" })).toHaveValue(
    "失败后保留草稿",
  );
  expect(sent).toHaveLength(3);
  uploadMode = "wait";
  const uploading = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith("/upload"),
  );
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await uploading;
  await page.getByRole("button", { name: "取消上传" }).click();
  await expect(page.getByRole("status")).toContainText("上传已取消");
  expect(sent).toHaveLength(3);
  await page.getByRole("button", { name: "移除附件" }).click();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "test-only-token",
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "退出账号" }).click();
  await expect(page.locator(".connect-card")).toBeVisible();
  expect(unexpected).toEqual([]);
});
