import { test, expect } from "@playwright/test";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import {
  encryptAttachment,
  decryptAttachment,
  MAX_ATTACHMENT,
} from "../src/attachments";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);

test("Matrix 附件加密与独立实现互通、随机密钥、拒绝篡改", async () => {
  const plain = new TextEncoder().encode("涟漪加密附件\nprivate bytes");
  const one = await encryptAttachment(plain.buffer),
    two = await encryptAttachment(plain.buffer);
  expect(one.metadata.key.k).not.toBe(two.metadata.key.k);
  expect(one.metadata.iv).not.toBe(two.metadata.iv);
  const iv = Buffer.from(one.metadata.iv, "base64");
  expect([...iv.subarray(8)]).toEqual(Array(8).fill(0));
  const decipher = createDecipheriv(
    "aes-256-ctr",
    Buffer.from(one.metadata.key.k, "base64url"),
    iv,
  );
  expect(
    Buffer.concat([
      decipher.update(Buffer.from(one.encrypted)),
      decipher.final(),
    ]),
  ).toEqual(Buffer.from(plain));
  const key = Buffer.alloc(32, 7),
    counter = Buffer.alloc(16, 0);
  counter[0] = 18;
  const cipher = createCipheriv("aes-256-ctr", key, counter);
  const fixture = Buffer.concat([cipher.update(plain), cipher.final()]);
  const info = {
    v: "v2",
    iv: counter.toString("base64").replace(/=+$/, ""),
    key: {
      kty: "oct",
      alg: "A256CTR",
      k: key.toString("base64url"),
      key_ops: ["encrypt", "decrypt"],
      ext: true,
    },
    hashes: {
      sha256: createHash("sha256")
        .update(fixture)
        .digest("base64")
        .replace(/=+$/, ""),
    },
  };
  expect(
    Buffer.from(await decryptAttachment(Uint8Array.from(fixture).buffer, info)),
  ).toEqual(Buffer.from(plain));
  const damaged = new Uint8Array(one.encrypted.slice(0));
  damaged[0] ^= 1;
  await expect(decryptAttachment(damaged.buffer, one.metadata)).rejects.toThrow(
    "完整性校验失败",
  );
});

test("图片预览、附件持久化与下载、撤回清理", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("添加附件")
    .setInputFiles({ name: "灵感.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".attachment-staging")).toContainText("灵感.png");
  await page.getByRole("textbox", { name: "输入消息" }).fill("分享一张图片");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const own = page.locator(".message.own").filter({ hasText: "分享一张图片" });
  await expect(own.locator("img")).toBeVisible();
  await own.getByRole("button", { name: "放大图片" }).click();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(own.locator("img")).toBeVisible();
  const downloading = page.waitForEvent("download");
  await own.getByRole("button", { name: "下载附件" }).click();
  const downloaded = await downloading;
  const stream = await downloaded.createReadStream();
  const parts: Buffer[] = [];
  for await (const part of stream!) parts.push(part);
  expect(Buffer.concat(parts)).toEqual(png);
  const id = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("ripple-demo")!)
        .find((r: any) => r.id === "design")
        .messages.at(-1).localFile,
  );
  await own.hover();
  await own.getByRole("button", { name: "撤回消息" }).click();
  await page.getByRole("button", { name: "保留消息" }).click();
  await expect(own).toBeVisible();
  await own.hover();
  await own.getByRole("button", { name: "撤回消息" }).click();
  await page.getByRole("button", { name: "确认撤回" }).click();
  await expect(page.locator(".message.redacted")).toContainText("消息已撤回");
  expect(
    await page.evaluate(
      (id) =>
        new Promise((resolve) => {
          const req = indexedDB.open("ripple-attachments");
          req.onsuccess = () => {
            const read = req.result
              .transaction("files")
              .objectStore("files")
              .get(id);
            read.onsuccess = () => {
              resolve(read.result === undefined);
              req.result.close();
            };
          };
        }),
      id,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator(".message.redacted")).toHaveCount(1);
});

test("普通文件、取消选择、大小限制与文字编辑", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("添加附件").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello ripple"),
  });
  await page.getByRole("button", { name: "移除附件" }).click();
  await expect(page.locator(".attachment-staging")).toHaveCount(0);
  await page.getByLabel("添加附件").setInputFiles({
    name: "large.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(MAX_ATTACHMENT + 1),
  });
  await expect(page.getByRole("status")).toContainText("25 MB");
  await page.getByLabel("添加附件").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello ripple"),
  });
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".file-card")).toContainText("notes.txt");
  await page.getByRole("textbox", { name: "输入消息" }).fill("修改之前");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const own = page.locator(".message.own").filter({ hasText: "修改之前" });
  await own.hover();
  await own.getByRole("button", { name: "编辑消息" }).click();
  await page.getByLabel("消息内容").fill("修改之后");
  await page.getByRole("button", { name: "保存修改" }).click();
  const updated = page.locator(".message.own").filter({ hasText: "修改之后" });
  await expect(updated.locator(".edited-label")).toHaveText("已编辑");
  await expect(
    page
      .locator(".message:not(.own)")
      .getByRole("button", { name: "编辑消息" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(updated).toHaveCount(1);
  await expect(updated).toBeInViewport();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "docs/ripple-v02.png", fullPage: true });
});

test("加密房间上传密文、消息携带密钥，取消后不发送", async () => {
  const { MatrixConnection } = await import("../src/matrix");
  const connection = new MatrixConnection(
    {
      baseUrl: "https://matrix.test",
      userId: "@a:matrix.test",
      deviceId: "TEST",
      accessToken: "test",
    },
    () => {},
  );
  let bytes: Blob | undefined;
  let opts: any;
  let content: any;
  let encrypted = true;
  connection.client.isRoomEncrypted = () => encrypted;
  connection.client.uploadContent = async (file, options) => {
    bytes = file as Blob;
    opts = options;
    return { content_uri: "mxc://matrix.test/encrypted" };
  };
  connection.client.sendMessage = (async (_id: string, body: unknown) => {
    content = body;
    return { event_id: "$attachment" };
  }) as typeof connection.client.sendMessage;
  const input = new File(["secret content"], "private-name.txt", {
    type: "text/plain",
  });
  await connection.sendAttachment(
    "!encrypted:matrix.test",
    input,
    "caption",
    () => {},
    new AbortController().signal,
  );
  expect(opts.includeFilename).toBe(false);
  expect(opts.name).not.toBe(input.name);
  const uploaded = await bytes!.arrayBuffer();
  expect(Buffer.from(uploaded).toString()).not.toBe("secret content");
  expect(content.file.url).toBe("mxc://matrix.test/encrypted");
  expect(content.url).toBeUndefined();
  expect(content.filename).toBe("private-name.txt");
  expect(
    Buffer.from(await decryptAttachment(uploaded, content.file)).toString(),
  ).toBe("secret content");
  content = undefined;
  const controller = new AbortController();
  controller.abort();
  await expect(
    connection.sendAttachment(
      "!encrypted:matrix.test",
      input,
      "",
      () => {},
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(content).toBeUndefined();
  encrypted = false;
});
