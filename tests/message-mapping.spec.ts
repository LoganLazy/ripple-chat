import { test, expect } from "@playwright/test";
import { MatrixEvent, Room, EventType, MsgType } from "matrix-js-sdk";
import { MatrixConnection } from "../src/matrix";
import { messageBody } from "../src/message-utils";
const account = {
  baseUrl: "https://matrix.test",
  userId: "@ripple:matrix.test",
  deviceId: "TEST",
  accessToken: "test",
};

test("加密控制事件不被误渲染为正在解密的聊天消息", () => {
  const connection = new MatrixConnection(account, () => {});
  const room = new Room("!room:matrix.test", connection.client, account.userId);
  room.name = "room";
  room.updateMyMembership("join");
  const reaction = new MatrixEvent({
    event_id: "$reaction",
    room_id: room.roomId,
    sender: account.userId,
    type: EventType.Reaction,
    content: {
      "m.relates_to": {
        rel_type: "m.annotation",
        event_id: "$message",
        key: "👍",
      },
    },
  });
  reaction.makeEncrypted(
    EventType.RoomMessageEncrypted,
    { algorithm: "m.megolm.v1.aes-sha2" },
    "key",
    "key",
  );
  const message = new MatrixEvent({
    event_id: "$message",
    room_id: room.roomId,
    sender: account.userId,
    type: EventType.RoomMessage,
    content: { msgtype: MsgType.Text, body: "真正的消息" },
  });
  message.makeEncrypted(
    EventType.RoomMessageEncrypted,
    { algorithm: "m.megolm.v1.aes-sha2" },
    "key",
    "key",
  );
  room.getLiveTimeline().getEvents().push(reaction, message);
  connection.client.getRooms = () => [room];
  expect(connection.rooms()[0].messages.map((m) => m.text)).toEqual([
    "真正的消息",
  ]);
});
test("普通引用文本保留，编辑富文本时不携带过期 HTML", async () => {
  expect(messageBody({ body: "> 普通引用\n\n正文" })).toBe(
    "> 普通引用\n\n正文",
  );
  const connection = new MatrixConnection(account, () => {});
  const original = new MatrixEvent({
    event_id: "$original",
    room_id: "!room:matrix.test",
    sender: account.userId,
    type: EventType.RoomMessage,
    content: {
      msgtype: MsgType.Text,
      body: "old",
      format: "org.matrix.custom.html",
      formatted_body: "<b>old</b>",
    },
  });
  connection.event = () => original;
  let sent: any;
  connection.client.sendMessage = (async (_room: string, content: unknown) => {
    sent = content;
    return { event_id: "$edit" };
  }) as typeof connection.client.sendMessage;
  await connection.edit("!room:matrix.test", "$original", "new");
  expect(sent["m.new_content"]).toEqual({ msgtype: "m.text", body: "new" });
});
