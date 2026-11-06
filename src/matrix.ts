import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events";
import {
  createClient,
  ClientEvent,
  RoomEvent,
  MatrixEventEvent,
  RoomMemberEvent,
  EventType,
  MsgType,
  Preset,
  Visibility,
  RelationType,
  type MatrixClient,
  type MatrixEvent,
  NotificationCountType,
} from "matrix-js-sdk";
import { messageBody, PendingMessageError } from "./message-utils";
import { TypingController } from "./typing";
import type { Account, ChatRoom, Message } from "./types";
import {
  validateFile,
  encryptAttachment,
  decryptAttachment,
  MAX_ATTACHMENT,
  isPreviewImage,
} from "./attachments";

export function serverUrl(input: string): string {
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("服务器必须使用 HTTPS，本机测试地址除外。");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("请输入有效的服务器地址。");
  return url.href.replace(/\/$/, "");
}
export function friendlyError(error: unknown): string {
  const e = error as { errcode?: string; message?: string };
  if (e.errcode === "M_FORBIDDEN")
    return "账号或密码不正确，或当前账号没有操作权限。";
  if (e.errcode === "M_UNKNOWN_TOKEN") return "登录已过期，请重新连接账号。";
  if (e.errcode === "M_LIMIT_EXCEEDED") return "操作太频繁，请稍后再试。";
  if (e.errcode === "M_NOT_FOUND") return "找不到这个房间，请检查房间地址。";
  if (e.message?.includes("fetch"))
    return "无法连接服务器，请检查地址、网络和服务器 CORS 配置。";
  return e.message || "操作失败，请稍后重试。";
}
export async function login(
  base: string,
  user: string,
  password: string,
  token?: string,
): Promise<Account> {
  if (
    typeof window !== "undefined" &&
    (!window.isSecureContext || !window.crypto?.subtle)
  )
    throw new Error(
      "真实 Matrix 登录需要安全环境。请使用 HTTPS、本机 localhost 地址或 Electron 桌面端。",
    );
  const baseUrl = serverUrl(base);
  if (token) {
    const probe = createClient({ baseUrl, accessToken: token });
    const info = await probe.whoami();
    if (!info.device_id)
      throw new Error("此令牌没有设备 ID，请使用账号密码登录。");
    return {
      baseUrl,
      accessToken: token,
      userId: info.user_id,
      deviceId: info.device_id,
    };
  }
  const probe = createClient({ baseUrl });
  const flows = await probe.loginFlows();
  if (!flows.flows.some((flow) => flow.type === "m.login.password"))
    throw new Error("此服务器未开放密码登录。请切换到访问令牌登录。");
  const response = await probe.login("m.login.password", {
    identifier: { type: "m.id.user", user },
    password,
    initial_device_display_name: "Ripple 涟漪",
  });
  return {
    baseUrl,
    accessToken: response.access_token,
    userId: response.user_id,
    deviceId: response.device_id,
  };
}
export class MatrixConnection {
  client: MatrixClient;
  private unlock?: () => void;
  private lifetime = new AbortController();
  private receipts = new Map<string, string>();
  private reading = new Map<string, Promise<void>>();
  private readRequests = new Map<string, MatrixEvent>();
  readonly typing: TypingController;
  constructor(
    account: Account,
    private update: (rooms: ChatRoom[], status?: string) => void,
  ) {
    this.client = createClient({
      baseUrl: account.baseUrl,
      accessToken: account.accessToken,
      userId: account.userId,
      deviceId: account.deviceId,
      disableVoip: true,
    });
    this.typing = new TypingController((room, active, timeout) =>
      this.client.sendTyping(room, active, timeout),
    );
  }
  async start() {
    if (navigator.locks) {
      let acquired!: (value: boolean) => void;
      let failed!: (reason: unknown) => void;
      const ready = new Promise<boolean>((resolve, reject) => {
        acquired = resolve;
        failed = reject;
      });
      void navigator.locks
        .request(
          `ripple-device-${this.client.getUserId()}-${this.client.getDeviceId()}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) {
              acquired(false);
              return;
            }
            await new Promise<void>((resolve) => {
              this.unlock = resolve;
              acquired(true);
            });
          },
        )
        .catch(failed);
      if (!(await ready))
        throw new Error("此设备已在另一个涟漪窗口中使用，请先退出那个窗口。");
    }
    // Keep each device's encryption store separate, including across accounts on one server.
    await this.client.initRustCrypto({
      cryptoDatabasePrefix: `ripple-crypto-${this.client.getUserId()}-${this.client.getDeviceId()}`,
    });
    const refresh = () => this.publish();
    this.client.on(ClientEvent.Sync, (state) =>
      this.publish(
        state === "PREPARED" || state === "SYNCING"
          ? "已连接 Matrix"
          : state === "ERROR" || state === "RECONNECTING"
            ? "连接中断，正在重连…"
            : "正在同步…",
      ),
    );
    this.client.on(RoomEvent.Timeline, refresh);
    this.client.on(RoomEvent.Name, refresh);
    this.client.on(RoomEvent.Redaction, refresh);
    this.client.on(RoomEvent.RedactionCancelled, refresh);
    this.client.on(MatrixEventEvent.Replaced, refresh);
    this.client.on(RoomEvent.MyMembership, refresh);
    this.client.on(RoomEvent.Receipt, refresh);
    this.client.on(RoomEvent.LocalEchoUpdated, refresh);
    this.client.on(MatrixEventEvent.Decrypted, refresh);
    this.client.on(RoomMemberEvent.Membership, refresh);
    this.client.on(RoomMemberEvent.Typing, refresh);
    await this.client.startClient({ initialSyncLimit: 50 });
  }
  private publish(status?: string) {
    if (!this.lifetime.signal.aborted) this.update(this.rooms(), status);
  }
  rooms(): ChatRoom[] {
    const directIds = new Set(
      Object.values(
        this.client.getAccountData(EventType.Direct)?.getContent() || {},
      ).flat() as string[],
    );
    return this.client
      .getRooms()
      .filter((room) => ["join", "invite"].includes(room.getMyMembership()))
      .map((room) => {
        const members = room
          .getJoinedMembers()
          .map((member) => ({ id: member.userId, name: member.name }));
        const messages = room
          .getLiveTimeline()
          .getEvents()
          .filter(
            (event) =>
              (event.getType() === EventType.RoomMessage ||
                event.getType() === EventType.RoomMessageEncrypted) &&
              event.getOriginalContent()["m.relates_to"]?.rel_type !==
                "m.replace",
          )
          .map((event): Message => {
            const content = event.getContent();
            const sender = event.getSender() || "";
            const replyId =
              content["m.relates_to"]?.["m.in_reply_to"]?.event_id;
            const original = replyId ? room.findEventById(replyId) : undefined;
            return {
              id: event.getId() || event.getTxnId() || String(event.getTs()),
              sender,
              name: room.getMember(sender)?.name || sender,
              text: event.isRedacted()
                ? "消息已撤回"
                : event.isDecryptionFailure()
                  ? "暂时无法解密此消息：此设备可能没有历史密钥。"
                  : event.getType() === EventType.RoomMessageEncrypted
                    ? "正在解密消息…"
                    : messageBody(content) || "（空消息）",
              time: event.getTs(),
              redacted: event.isRedacted(),
              edited: Boolean(event.replacingEventId()),
              replyId,
              reply: original
                ? original.isRedacted()
                  ? "原消息已撤回"
                  : messageBody(original.getContent()) || "附件消息"
                : replyId
                  ? "原消息尚未加载"
                  : undefined,
              filename: content.filename || content.body,
              mimetype: content.info?.mimetype,
              size: content.info?.size,
              mediaUri: content.file?.url || content.url,
              encryptedFile: content.file,
              own: sender === this.client.getUserId(),
              encrypted: event.isEncrypted(),
              pending:
                event.status === "sending" ||
                event.status === "queued" ||
                event.status === "encrypting",
              failed: event.status === "not_sent",
              kind:
                content.msgtype === MsgType.Image
                  ? "image"
                  : content.msgtype === MsgType.File
                    ? "file"
                    : "text",
            };
          });
        return {
          id: room.roomId,
          name: room.name || room.roomId,
          description:
            room.currentState
              .getStateEvents(EventType.RoomTopic, "")
              ?.getContent().topic || "在这里开启一段新的对话。",
          color: ["purple", "peach", "mint", "blue", "sand"][
            Math.abs(
              [...room.roomId].reduce((a, c) => a + c.charCodeAt(0), 0),
            ) % 5
          ],
          symbol: room.name?.slice(0, 1) || "#",
          direct: directIds.has(room.roomId),
          unread: room.getUnreadNotificationCount(),
          members,
          typing: room
            .getJoinedMembers()
            .filter(
              (member) =>
                member.typing && member.userId !== this.client.getUserId(),
            )
            .map((member) => member.name),
          messages,
          encrypted: this.client.isRoomEncrypted(room.roomId),
          invited: room.getMyMembership() === "invite",
          hasOlder: room.oldState.paginationToken !== null,
        };
      })
      .sort(
        (a, b) =>
          (b.messages.at(-1)?.time || 0) - (a.messages.at(-1)?.time || 0),
      );
  }
  private async sendTracked(roomId: string, content: RoomMessageEventContent) {
    const txn = this.client.makeTxnId();
    try {
      return await this.client.sendMessage(roomId, content, txn);
    } catch (error) {
      const event = this.client
        .getRoom(roomId)
        ?.getLiveTimeline()
        .getEvents()
        .find((e) => e.getTxnId() === txn);
      if (event?.status === "not_sent" && event.getId())
        throw new PendingMessageError(event.getId()!, error);
      throw error;
    }
  }
  async send(roomId: string, text: string, reply?: string) {
    await this.sendTracked(roomId, {
      msgtype: MsgType.Text,
      body: text,
      ...(reply
        ? { "m.relates_to": { "m.in_reply_to": { event_id: reply } } }
        : {}),
    });
  }
  async edit(roomId: string, id: string, body: string) {
    const event = this.event(roomId, id);
    if (
      !event ||
      event.getSender() !== this.client.getUserId() ||
      event.isRedacted() ||
      event.getContent().msgtype !== MsgType.Text
    )
      throw new Error("只能编辑自己发送的文字消息。");
    const reply = event.getContent()["m.relates_to"]?.["m.in_reply_to"];
    const content = {
      msgtype: MsgType.Text as const,
      body,
      ...(reply ? { "m.relates_to": { "m.in_reply_to": reply } } : {}),
    };
    try {
      await this.sendTracked(roomId, {
        msgtype: MsgType.Text,
        body: `* ${body}`,
        "m.new_content": content,
        "m.relates_to": { rel_type: RelationType.Replace, event_id: id },
      });
    } catch (error) {
      if (error instanceof PendingMessageError) {
        this.discard(roomId, error.eventId);
        throw error.cause;
      }
      throw error;
    }
    this.publish();
  }
  async redact(roomId: string, id: string) {
    const event = this.event(roomId, id);
    if (
      !event ||
      event.getSender() !== this.client.getUserId() ||
      event.isRedacted()
    )
      throw new Error("只能撤回自己的消息。");
    const txn = this.client.makeTxnId();
    try {
      await this.client.redactEvent(roomId, id, txn);
    } catch (error) {
      const failed = this.client
        .getRoom(roomId)
        ?.getLiveTimeline()
        .getEvents()
        .find((e) => e.getTxnId() === txn);
      if (failed?.status === "not_sent") this.client.cancelPendingEvent(failed);
      this.publish();
      throw error;
    }
    this.publish();
  }
  async sendAttachment(
    roomId: string,
    file: File,
    caption: string,
    progress: (percent: number) => void,
    signal: AbortSignal,
  ) {
    validateFile(file);
    const active = AbortSignal.any([signal, this.lifetime.signal]);
    active.throwIfAborted();
    const encryptedRoom = this.client.isRoomEncrypted(roomId);
    const result = encryptedRoom
      ? await encryptAttachment(await file.arrayBuffer())
      : undefined;
    active.throwIfAborted();
    const upload = this.client.uploadContent(
      result
        ? new Blob([result.encrypted], { type: "application/octet-stream" })
        : file,
      {
        type: result
          ? "application/octet-stream"
          : file.type || "application/octet-stream",
        name: result ? "encrypted-file" : file.name,
        includeFilename: !result,
        progressHandler: ({ loaded, total }) =>
          progress(
            total ? Math.min(99, Math.round((loaded / total) * 100)) : 0,
          ),
      },
    );
    const cancel = () => this.client.cancelUpload(upload);
    active.addEventListener("abort", cancel, { once: true });
    try {
      const response = await upload;
      active.throwIfAborted();
      if (!encryptedRoom && this.client.isRoomEncrypted(roomId))
        throw new Error("房间刚刚启用了加密，请重新发送此附件。");
      progress(100);
      // Attachment key/IV travels inside the encrypted room message, never in the upload.
      const content = {
        body: caption || file.name,
        filename: file.name,
        info: {
          mimetype: file.type || "application/octet-stream",
          size: file.size,
        },
        ...(result
          ? { file: { ...result.metadata, url: response.content_uri } }
          : { url: response.content_uri }),
      };
      if (isPreviewImage(file.type))
        await this.sendTracked(roomId, {
          ...content,
          msgtype: MsgType.Image,
        });
      else
        await this.sendTracked(roomId, {
          ...content,
          msgtype: MsgType.File,
        });
      progress(100);
    } finally {
      active.removeEventListener("abort", cancel);
    }
  }
  async download(message: Message, signal?: AbortSignal): Promise<Blob> {
    if (!message.mediaUri?.startsWith("mxc://"))
      throw new Error("附件地址无效。");
    if ((message.size || 0) > MAX_ATTACHMENT)
      throw new Error("此版本仅支持下载 25 MB 以内的附件。");
    const active = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(60000),
      ...(signal ? [signal] : []),
    ]);
    const versions = await this.client.getVersions();
    const authenticated = versions.versions.some((version) => {
      const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
      return major > 1 || (major === 1 && minor >= 11);
    });
    const address = this.client.mxcUrlToHttp(
      message.mediaUri,
      undefined,
      undefined,
      undefined,
      false,
      false,
      authenticated,
    );
    if (
      !address ||
      new URL(address).origin !== new URL(this.client.baseUrl).origin
    )
      throw new Error("拒绝访问非服务器媒体地址。");
    const response = await fetch(address, {
      headers: { Authorization: `Bearer ${this.client.getAccessToken()}` },
      signal: active,
      redirect: "error",
    });
    if (!response.ok) throw new Error(`附件下载失败（${response.status}）。`);
    if (Number(response.headers.get("content-length")) > MAX_ATTACHMENT) {
      await response.body?.cancel();
      throw new Error("附件超过 25 MB。");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("附件为空。");
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > MAX_ATTACHMENT) throw new Error("附件超过 25 MB。");
        chunks.push(part.value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    }
    const data = await new Blob(chunks).arrayBuffer();
    const plain = message.encryptedFile
      ? await decryptAttachment(data, message.encryptedFile)
      : data;
    active.throwIfAborted();
    return new Blob([plain], {
      type: isPreviewImage(message.mimetype)
        ? message.mimetype
        : "application/octet-stream",
    });
  }
  async join(roomId: string) {
    return (await this.client.joinRoom(roomId)).roomId;
  }
  async create(name: string, topic: string) {
    const result = await this.client.createRoom({
      name,
      topic,
      preset: Preset.PrivateChat,
      visibility: Visibility.Private,
      initial_state: [
        {
          type: EventType.RoomEncryption,
          state_key: "",
          content: { algorithm: "m.megolm.v1.aes-sha2" },
        },
      ],
    });
    return result.room_id;
  }
  async invite(roomId: string, userId: string) {
    await this.client.invite(roomId, userId);
  }
  async older(roomId: string) {
    const room = this.client.getRoom(roomId);
    if (room) {
      await this.client.scrollback(room, 30);
      this.publish();
    }
  }
  async read(roomId: string) {
    const room = this.client.getRoom(roomId);
    const event = room
      ?.getLiveTimeline()
      .getEvents()
      .filter((e) => !e.status)
      .at(-1);
    const id = event?.getId();
    if (!event || !room || !id || this.receipts.get(roomId) === id) return;
    this.readRequests.set(roomId, event);
    if (this.reading.has(roomId)) return this.reading.get(roomId);
    const task = this.flushReceipts(roomId).finally(() => {
      this.reading.delete(roomId);
      this.readRequests.delete(roomId);
    });
    this.reading.set(roomId, task);
    return task;
  }
  private async flushReceipts(roomId: string) {
    while (this.readRequests.has(roomId) && !this.lifetime.signal.aborted) {
      const event = this.readRequests.get(roomId)!;
      this.readRequests.delete(roomId);
      const id = event.getId()!;
      if (this.receipts.get(roomId) === id) continue;
      await this.client.sendReadReceipt(event);
      this.receipts.set(roomId, id);
      const room = this.client.getRoom(roomId);
      if (
        room
          ?.getLiveTimeline()
          .getEvents()
          .filter((e) => !e.status)
          .at(-1)
          ?.getId() === id
      ) {
        room!.setUnreadNotificationCount(NotificationCountType.Total, 0);
        room!.setUnreadNotificationCount(NotificationCountType.Highlight, 0);
        this.publish();
      }
    }
  }
  async retry(roomId: string, eventId: string) {
    const room = this.client.getRoom(roomId);
    const event = room?.findEventById(eventId);
    if (
      event &&
      room &&
      event.status === "not_sent" &&
      event.getSender() === this.client.getUserId()
    )
      await this.client.resendEvent(event, room);
  }
  discard(roomId: string, eventId: string) {
    const event = this.event(roomId, eventId);
    if (
      event?.status === "not_sent" &&
      event.getSender() === this.client.getUserId()
    ) {
      this.client.cancelPendingEvent(event);
      this.publish();
    }
  }
  event(roomId: string, id: string): MatrixEvent | undefined {
    return this.client.getRoom(roomId)?.findEventById(id);
  }
  stop() {
    void this.typing.stop();
    this.lifetime.abort();
    for (const upload of this.client.getCurrentUploads())
      this.client.cancelUpload(upload.promise);
    this.client.stopClient();
    this.client.removeAllListeners();
    this.unlock?.();
    this.unlock = undefined;
  }
  async logout() {
    try {
      await this.client.logout();
    } finally {
      this.stop();
    }
  }
}
