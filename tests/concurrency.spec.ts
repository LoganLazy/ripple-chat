import { test, expect } from "@playwright/test";
import { MatrixEvent, Room, EventType } from "matrix-js-sdk";
import { MatrixConnection } from "../src/matrix";
import { TypingController } from "../src/typing";

test("慢回执只补发期间实际读过的消息，不自动确认后来未读的消息", async () => {
  const connection = new MatrixConnection(
    {
      baseUrl: "https://matrix.test",
      userId: "@me:matrix.test",
      accessToken: "test",
      deviceId: "TEST",
    },
    () => {},
  );
  const room = new Room(
    "!room:matrix.test",
    connection.client,
    "@me:matrix.test",
  );
  connection.client.getRoom = () => room;
  const events = room.getLiveTimeline().getEvents();
  const add = (id: string) =>
    events.push(
      new MatrixEvent({
        event_id: id,
        type: EventType.RoomMessage,
        content: { msgtype: "m.text", body: id },
        sender: "@friend:matrix.test",
      }),
    );
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const receipts: string[] = [];
  connection.client.sendReadReceipt = (async (event: MatrixEvent) => {
    receipts.push(event.getId()!);
    if (receipts.length === 1) await barrier;
    return {};
  }) as typeof connection.client.sendReadReceipt;
  add("$first");
  const first = connection.read(room.roomId);
  add("$read-during-request");
  const second = connection.read(room.roomId);
  add("$not-yet-read");
  release();
  await Promise.all([first, second]);
  expect(receipts).toEqual(["$first", "$read-during-request"]);
  await connection.read(room.roomId);
  expect(receipts.at(-1)).toBe("$not-yet-read");
});

test("慢输入状态请求完成后再发送停止状态，切房间清理旧状态", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: [string, boolean][] = [];
  const typing = new TypingController(async (room, active) => {
    requests.push([room, active]);
    if (requests.length === 1) await barrier;
  });
  typing.update("first", true);
  await Promise.resolve();
  typing.update("second", true);
  const stopped = typing.stop();
  expect(requests).toEqual([["first", true]]);
  release();
  await stopped;
  expect(requests).toEqual([
    ["first", true],
    ["first", false],
    ["second", false],
  ]);
});
