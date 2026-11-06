import type { Page } from "@playwright/test";
export async function mockMatrix(page: Page, historyCount = 3) {
  const user = "@ripple:matrix.test";
  const primary = "!a:matrix.test",
    secondary = "!b:matrix.test";
  let sequence = 0,
    serial = 0,
    failSend = false,
    failEdit = false;
  const receipts: string[] = [],
    typingRequests: { room: string; typing: boolean; timeout?: number }[] = [],
    sends: { txn: string; content: any }[] = [];
  const queued: Record<string, any[]> = { [primary]: [], [secondary]: [] };
  const ephemeral: Record<string, any[]> = { [primary]: [], [secondary]: [] };
  const stamp = Date.now() - 60000;
  const event = (
    body: string,
    id: string,
    time: number,
    sender = "@friend:matrix.test",
    content?: any,
  ) => ({
    type: "m.room.message",
    sender,
    event_id: id,
    origin_server_ts: time,
    content: content || { msgtype: "m.text", body },
  });
  const state = (type: string, content: any, state_key = "") => ({
    type,
    content,
    state_key,
    sender: user,
    event_id: `$state${serial++}`,
    origin_server_ts: stamp,
  });
  await page.route("https://matrix.test/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = decodeURIComponent(url.pathname);
    const reply = (json: any, status = 200) => route.fulfill({ json, status });
    if (path.endsWith("/versions"))
      return reply({ versions: ["v1.11"], unstable_features: {} });
    if (path.endsWith("/login"))
      return reply(
        request.method() === "GET"
          ? { flows: [{ type: "m.login.password" }] }
          : {
              user_id: user,
              access_token: "fixture-token",
              device_id: `DEVICE${serial++}`,
            },
      );
    if (path.endsWith("/pushrules/"))
      return reply({
        global: {
          override: [],
          content: [],
          room: [],
          sender: [],
          underride: [],
        },
      });
    if (path.includes("/filter")) return reply({ filter_id: "1" });
    if (path.endsWith("/keys/upload"))
      return reply({ one_time_key_counts: { signed_curve25519: 50 } });
    if (path.endsWith("/keys/query"))
      return reply({ device_keys: {}, failures: {} });
    if (path.includes("/room_keys/version"))
      return reply({ errcode: "M_NOT_FOUND", error: "No backup" }, 404);
    if (path.endsWith("/sync")) {
      const first = sequence++ === 0;
      if (!first) await new Promise((resolve) => setTimeout(resolve, 120));
      const join = Object.fromEntries(
        [primary, secondary].map((room, i) => [
          room,
          {
            state: {
              events: first
                ? [
                    state("m.room.create", {
                      creator: user,
                      room_version: "10",
                    }),
                    state("m.room.name", {
                      name: i ? "另一个房间" : "当前房间",
                    }),
                    state(
                      "m.room.member",
                      { membership: "join", displayname: "我" },
                      user,
                    ),
                    state(
                      "m.room.member",
                      { membership: "join", displayname: "好友" },
                      "@friend:matrix.test",
                    ),
                  ]
                : [],
            },
            timeline: {
              events: first
                ? Array.from({ length: i ? 1 : historyCount }, (_, n) =>
                    event(
                      `消息 ${i}-${n}`,
                      `$${i}-${n}`,
                      stamp + n * 100 + (i ? -10000 : 0),
                    ),
                  )
                : queued[room].splice(0),
              limited: false,
              prev_batch: "history",
            },
            ephemeral: { events: ephemeral[room].splice(0) },
            account_data: { events: [] },
            unread_notifications: { notification_count: 1, highlight_count: 0 },
          },
        ]),
      );
      return reply({
        next_batch: `s${sequence}`,
        rooms: { join },
        presence: { events: [] },
        account_data: { events: [] },
        to_device: { events: [] },
        device_lists: { changed: [], left: [] },
        device_one_time_keys_count: { signed_curve25519: 50 },
      });
    }
    if (path.includes("/messages"))
      return reply({
        start: "history",
        end: null,
        chunk: Array.from({ length: 15 }, (_, n) =>
          event(`历史消息 ${n}`, `$history${n}`, stamp - n * 1000 - 20000),
        ),
        state: [],
      });
    if (path.includes("/receipt/")) {
      receipts.push(path);
      return reply({});
    }
    if (path.includes("/typing/")) {
      typingRequests.push({
        room: path.split("/rooms/")[1].split("/typing/")[0],
        ...request.postDataJSON(),
      });
      return reply({});
    }
    if (path.includes("/send/m.room.message/")) {
      const content = request.postDataJSON();
      const txn = path.split("/").at(-1)!;
      sends.push({ txn, content });
      if (
        failSend ||
        (failEdit && content["m.relates_to"]?.rel_type === "m.replace")
      ) {
        failSend = false;
        failEdit = false;
        return reply(
          { errcode: "M_FORBIDDEN", error: "Temporarily denied" },
          403,
        );
      }
      const id = `$sent-${txn}`;
      queued[primary].push({
        ...event(content.body, id, Date.now(), user, content),
        unsigned: { transaction_id: txn },
      });
      return reply({ event_id: id });
    }
    return reply({});
  });
  return {
    primary,
    secondary,
    receipts,
    typingRequests,
    typing: (ids: string[], room = primary) =>
      ephemeral[room].push({ type: "m.typing", content: { user_ids: ids } }),
    sends,
    failNextSend: () => {
      failSend = true;
    },
    failNextEdit: () => {
      failEdit = true;
    },
    push: (body: string, room = primary, content?: any) => {
      const id = `$incoming${serial++}`;
      queued[room].push(
        event(body, id, Date.now(), "@friend:matrix.test", content),
      );
      return id;
    },
  };
}
export async function connectMatrix(page: Page) {
  await page.locator(".connect-card").click();
  await page.getByLabel("服务器地址").fill("https://matrix.test");
  await page.getByLabel("Matrix 账号").fill("@ripple:matrix.test");
  await page.getByLabel("密码", { exact: true }).fill("test");
  await page.getByRole("button", { name: "连接 Matrix", exact: true }).click();
  await page
    .locator(".chat-title h2")
    .filter({ hasText: "当前房间" })
    .waitFor({ state: "attached" });
}
