import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Asterisk,
  Coffee,
  Music2,
  MessageCircle,
  Plus,
  Search,
  Settings,
  ChevronDown,
  ArrowUpRight,
  Hash,
  Users,
  X,
  Send,
  Smile,
  Reply,
  CheckCheck,
  Moon,
  Sun,
  LogOut,
  ArrowLeft,
  ArrowDown,
  Pin,
  ShieldCheck,
  Sparkles,
  Compass,
  Copy,
  LoaderCircle,
  Link,
  LockKeyhole,
  ChevronRight,
  CircleHelp,
  AtSign,
  Paperclip,
  Pencil,
  Trash2,
  FileText,
} from "lucide-react";
import type { Account, ChatRoom, Message } from "./types";
import type { MatrixConnection } from "./matrix";
import { demoRooms } from "./demo";
import { randomId, copyText } from "./browser-utils";
import { useTimelineNavigation } from "./useTimelineNavigation";
import {
  readPreference,
  writePreference,
  validRooms,
  validPins,
  validTheme,
} from "./storage";
import { PendingMessageError } from "./message-utils";
import Attachment from "./Attachment";
import {
  validateFile,
  saveLocalFile,
  removeLocalFile,
  fileSize,
  isPreviewImage,
} from "./attachments";

const timeLabel = (time: number) =>
  new Date(time).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
function Avatar({
  name,
  color = "purple",
  symbol,
  small = false,
}: {
  name: string;
  color?: string;
  symbol?: string;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${color} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {symbol === "✳" ? (
        <Asterisk size={small ? 22 : 29} />
      ) : symbol === "☕" ? (
        <Coffee size={22} />
      ) : symbol === "♫" ? (
        <Music2 size={22} />
      ) : (
        symbol || name.slice(0, 1)
      )}
    </span>
  );
}
function IconButton({
  children,
  label,
  onClick,
  active = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  subtitle,
  children,
  close,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const items = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input, textarea, select, a[href]",
          ) || []),
        ];
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label="关闭弹窗" onClick={close}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const [demo, setDemo] = useState<ChatRoom[]>(() =>
    readPreference("ripple-demo", structuredClone(demoRooms), validRooms),
  );
  const [live, setLive] = useState<ChatRoom[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [selected, setSelected] = useState("design");
  const [awaitingRoom, setAwaitingRoom] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const historyAnchor = useRef<{
    room: string;
    id: string;
    top: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [theme, setTheme] = useState(() =>
    readPreference("ripple-theme", "light", validTheme),
  );
  const [pins, setPins] = useState<string[]>(() =>
    readPreference("ripple-pins", ["design"], validPins),
  );
  const [info, setInfo] = useState(() => window.innerWidth >= 1190);
  const [modal, setModal] = useState<
    "login" | "new" | "settings" | "invite" | "help" | null
  >(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reply, setReply] = useState<Message | null>(null);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editing, setEditing] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [redacting, setRedacting] = useState<Message | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  const [emoji, setEmoji] = useState(false);
  const [searchMessages, setSearchMessages] = useState(false);
  const [messageQuery, setMessageQuery] = useState("");
  const [toast, setToast] = useState("");
  const [status, setStatus] = useState("本地演示空间");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [loginMode, setLoginMode] = useState("password");
  const [roomMode, setRoomMode] = useState("create");
  const [mobileChat, setMobileChat] = useState(false);
  const connection = useRef<MatrixConnection | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const formBusy = useRef(false);
  const nearBottom = useRef(true);
  const rooms = account ? live : demo;
  const room =
    rooms.find((r) => r.id === selected) ||
    (awaitingRoom ? undefined : rooms[0]);
  const currentRoomId = useRef(room?.id);
  currentRoomId.current = room?.id;
  useEffect(() => {
    if (awaitingRoom) {
      if (rooms.some((r) => r.id === awaitingRoom)) setAwaitingRoom(null);
      return;
    }
    if (room && room.id !== selected) {
      setStagedFile(null);
      setReply(null);
      historyAnchor.current = null;
      setSelected(room.id);
    }
  }, [rooms, room?.id, selected, awaitingRoom]);
  const draft = drafts[room?.id || ""] || "";
  const timeline = useTimelineNavigation(
    room,
    account ? `${account.baseUrl}/${account.userId}` : "demo",
    messageQuery,
    () => setMessageQuery(""),
    scroll,
    nearBottom,
  );
  const messages =
    room?.messages.filter(
      (m) =>
        !messageQuery ||
        `${m.text} ${m.name}`
          .toLowerCase()
          .includes(messageQuery.toLowerCase()),
    ) || [];
  const unread = rooms.reduce((total, r) => total + r.unread, 0);
  const visibleRooms = rooms.filter(
    (r) =>
      (!query || r.name.toLowerCase().includes(query.toLowerCase())) &&
      (filter === "all" ||
        (filter === "unread" && r.unread > 0) ||
        (filter === "direct" && r.direct)),
  );
  const notify = (text: string) => setToast(text);
  const open = (value: typeof modal) => {
    setError("");
    setModal(value);
  };
  const changeDraft = (text: string) => {
    if (!room) return;
    setDrafts((d) => ({ ...d, [room.id]: text }));
    if (account && !room.invited)
      connection.current?.typing.update(
        room.id,
        Boolean(text.trim()) &&
          document.visibilityState === "visible" &&
          document.hasFocus(),
      );
  };
  useEffect(() => {
    const active = connection.current;
    const stopTyping = () => {
      void active?.typing.stop();
    };
    const hidden = () => {
      if (document.visibilityState !== "visible") stopTyping();
    };
    window.addEventListener("blur", stopTyping);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      stopTyping();
      window.removeEventListener("blur", stopTyping);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [account, room?.id, mobileChat]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (!writePreference("ripple-theme", theme))
      notify("偏好无法保存，本次仍可继续使用。");
  }, [theme]);
  useEffect(() => {
    if (!writePreference("ripple-demo", demo))
      notify("本地存储不可用，当前演示消息在关闭后不会保留。");
  }, [demo]);
  useEffect(() => {
    if (!writePreference("ripple-pins", pins))
      notify("置顶暂时无法保存，本次仍可继续使用。");
  }, [pins]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (nearBottom.current)
      scroll.current?.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: "instant",
      });
  }, [room?.messages.length, selected, messageQuery]);
  useEffect(
    () => () => {
      uploadAbort.current?.abort();
      connection.current?.stop();
    },
    [],
  );
  const readVisible = () => {
    const el = scroll.current;
    if (
      !account ||
      !room ||
      room.invited ||
      !el ||
      document.visibilityState !== "visible" ||
      !document.hasFocus() ||
      (!mobileChat && window.innerWidth <= 600) ||
      messageQuery ||
      !nearBottom.current
    )
      return;
    void connection.current?.read(room.id).catch(() => {});
  };
  const readVisibleRef = useRef(readVisible);
  readVisibleRef.current = readVisible;
  useEffect(() => {
    readVisibleRef.current();
  }, [account, room?.id, room?.messages.at(-1)?.id, mobileChat, messageQuery]);
  useEffect(() => {
    const read = () => readVisibleRef.current();
    window.addEventListener("focus", read);
    window.addEventListener("resize", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.removeEventListener("focus", read);
      window.removeEventListener("resize", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  useLayoutEffect(() => {
    const saved = historyAnchor.current,
      container = scroll.current;
    if (!saved || !container || saved.room !== room?.id) return;
    const element = [
      ...container.querySelectorAll<HTMLElement>("[data-message-id]"),
    ].find((e) => e.dataset.messageId === saved.id);
    if (element)
      container.scrollTop += element.getBoundingClientRect().top - saved.top;
  }, [room?.id, room?.messages.length, room?.hasOlder]);
  useEffect(() => {
    const container = scroll.current;
    const content = container?.querySelector(".messages-content");
    if (!container || !content) return;
    const resize = new ResizeObserver(() => {
      if (nearBottom.current) container.scrollTop = container.scrollHeight;
    });
    resize.observe(content);
    return () => resize.disconnect();
  }, [room?.id]);
  const pickRoom = (id: string) => {
    if (sendLock.current) {
      notify("消息发送中，请稍后切换会话或取消上传。");
      return;
    }
    historyAnchor.current = null;
    setAwaitingRoom(null);
    setSelected(id);
    setMobileChat(true);
    if (!sendLock.current) setStagedFile(null);
    setReply(null);
    setMessageQuery("");
    nearBottom.current = true;
    if (!account)
      setDemo((rs) => rs.map((r) => (r.id === id ? { ...r, unread: 0 } : r)));
  };
  async function attempt(action: () => Promise<void>) {
    if (formBusy.current) return;
    formBusy.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      const { friendlyError } = await import("./matrix");
      setError(friendlyError(e));
    } finally {
      formBusy.current = false;
      setBusy(false);
    }
  }
  function clearSessionUI() {
    setDrafts({});
    setStagedFile(null);
    setReply(null);
    setEditing(null);
    setRedacting(null);
    setEditText("");
    setEmoji(false);
    setMessageQuery("");
    setSearchMessages(false);
    setQuery("");
    setFilter("all");
    setAwaitingRoom(null);
    setLoadingHistory(null);
    historyAnchor.current = null;
    nearBottom.current = true;
  }
  async function loadOlder() {
    const active = connection.current,
      target = room,
      container = scroll.current;
    if (!active || !target || !container || loadingHistory) return;
    const bounds = container.getBoundingClientRect();
    const visible = [
      ...container.querySelectorAll<HTMLElement>("[data-message-id]"),
    ].find((e) => e.getBoundingClientRect().bottom > bounds.top);
    if (visible)
      historyAnchor.current = {
        room: target.id,
        id: visible.dataset.messageId!,
        top: visible.getBoundingClientRect().top,
      };
    nearBottom.current = false;
    setLoadingHistory(target.id);
    try {
      await active.older(target.id);
    } catch {
      if (connection.current === active) notify("历史消息加载失败，请稍后重试");
    } finally {
      if (connection.current === active) {
        setLoadingHistory(null);
        requestAnimationFrame(() => {
          if (historyAnchor.current?.room === target.id)
            historyAnchor.current = null;
        });
      }
    }
  }
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendLock.current) {
      setError("请先完成当前发送或取消上传。");
      return;
    }
    const data = new FormData(event.currentTarget);
    await attempt(async () => {
      const { login, MatrixConnection } = await import("./matrix");
      const credentials = await login(
        String(data.get("server")).trim(),
        String(data.get("user") || "").trim(),
        String(data.get("password") || ""),
        loginMode === "token" ? String(data.get("token")).trim() : undefined,
      );
      const client = new MatrixConnection(credentials, (nextRooms, state) => {
        if (connection.current !== client) return;
        setLive(nextRooms);
        if (state) setStatus(state);
      });
      try {
        await client.start();
      } catch (e) {
        client.stop();
        throw e;
      }
      uploadAbort.current?.abort();
      connection.current?.stop();
      connection.current = client;
      clearSessionUI();
      setAccount(credentials);
      setLive(client.rooms());
      setSelected("");
      setQuery("");
      setFilter("all");
      setStatus("正在同步…");
      setModal(null);
      notify("已登录，正在同步你的会话");
    });
  }
  function chooseFile(file?: File) {
    if (!file || sendLock.current) return;
    try {
      validateFile(file);
      setStagedFile(file);
      setReply(null);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function send() {
    if (
      (!draft.trim() && !stagedFile) ||
      !room ||
      sendLock.current ||
      room.invited
    )
      return;
    const text = draft.trim(),
      roomId = room.id,
      replying = reply,
      attached = stagedFile;
    sendLock.current = true;
    void connection.current?.typing.stop();
    const controller = new AbortController();
    uploadAbort.current = controller;
    setUploadProgress(0);
    setSending(true);
    try {
      if (attached) {
        if (account)
          await connection.current!.sendAttachment(
            roomId,
            attached,
            text,
            setUploadProgress,
            controller.signal,
          );
        else {
          const id = randomId();
          await saveLocalFile(id, attached, controller.signal);
          setDemo((rs) =>
            rs.map((r) =>
              r.id === roomId
                ? {
                    ...r,
                    messages: [
                      ...r.messages,
                      {
                        id,
                        sender: "me",
                        name: "我",
                        text: text || attached.name,
                        time: Date.now(),
                        own: true,
                        kind: isPreviewImage(attached.type) ? "image" : "file",
                        filename: attached.name,
                        mimetype: attached.type,
                        size: attached.size,
                        localFile: id,
                      },
                    ],
                  }
                : r,
            ),
          );
        }
        setStagedFile((current) => (current === attached ? null : current));
      } else if (account)
        await connection.current!.send(roomId, text, replying?.id);
      else
        setDemo((rs) =>
          rs.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  messages: [
                    ...r.messages,
                    {
                      id: randomId(),
                      sender: "me",
                      name: "我",
                      text,
                      time: Date.now(),
                      own: true,
                      reply: replying?.text,
                      replyId: replying?.id,
                    },
                  ],
                }
              : r,
          ),
        );
      setDrafts((d) =>
        d[roomId]?.trim() === text ? { ...d, [roomId]: "" } : d,
      );
      setReply(null);
      setEmoji(false);
      nearBottom.current = true;
      timeline.latest();
    } catch (e) {
      if (e instanceof PendingMessageError) {
        setDrafts((d) =>
          d[roomId]?.trim() === text ? { ...d, [roomId]: "" } : d,
        );
        setStagedFile((current) => (current === attached ? null : current));
        setReply(null);
        notify(e.message);
      } else if (
        controller.signal.aborted ||
        (e as Error).name === "AbortError"
      )
        notify("附件上传已取消");
      else notify((await import("./matrix")).friendlyError(e));
    } finally {
      sendLock.current = false;
      uploadAbort.current = null;
      setSending(false);
      composer.current?.focus();
    }
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !room || !editText.trim()) return;
    const target = editing,
      roomId = room.id,
      text = editText.trim();
    await attempt(async () => {
      if (account) await connection.current!.edit(roomId, target.id, text);
      else
        setDemo((rs) =>
          rs.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  messages: r.messages.map((m) =>
                    m.id === target.id
                      ? { ...m, text, edited: true }
                      : m.replyId === target.id
                        ? { ...m, reply: text }
                        : m,
                  ),
                }
              : r,
          ),
        );
      setEditing(null);
      notify("消息已更新");
    });
  }
  async function confirmRedact() {
    if (!redacting || !room) return;
    const target = redacting,
      roomId = room.id;
    await attempt(async () => {
      if (account) await connection.current!.redact(roomId, target.id);
      else {
        if (target.localFile) await removeLocalFile(target.localFile);
        setDemo((rs) =>
          rs.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  messages: r.messages.map((m) =>
                    m.id === target.id
                      ? {
                          id: m.id,
                          sender: m.sender,
                          name: m.name,
                          time: m.time,
                          own: true,
                          text: "消息已撤回",
                          redacted: true,
                        }
                      : m.replyId === target.id
                        ? { ...m, reply: "原消息已撤回" }
                        : m,
                  ),
                }
              : r,
          ),
        );
      }
      if (reply?.id === target.id) setReply(null);
      setRedacting(null);
      notify("消息已撤回");
    });
  }
  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendLock.current) {
      setError("请先完成当前发送或取消上传。");
      return;
    }
    const data = new FormData(event.currentTarget);
    await attempt(async () => {
      if (roomMode === "join") {
        const id = String(data.get("address")).trim();
        if (!account) {
          setError("加入真实房间需要先连接 Matrix 账号。");
          return;
        }
        const joined = await connection.current!.join(id);
        setAwaitingRoom(joined);
        setSelected(joined);
        notify("已加入房间");
      } else {
        const name = String(data.get("name")).trim(),
          topic = String(data.get("topic")).trim();
        if (!name) throw new Error("请填写房间名称。");
        if (account) {
          const id = await connection.current!.create(name, topic);
          setAwaitingRoom(id);
          setSelected(id);
        } else {
          const id = randomId();
          setDemo((rs) => [
            ...rs,
            {
              id,
              name,
              description: topic || "新的想法，从这里开始。",
              symbol: name.slice(0, 1),
              color: "purple",
              unread: 0,
              members: [{ id: "me", name: "我" }],
              messages: [],
            },
          ]);
          setSelected(id);
        }
        notify(account ? "加密房间已创建" : "演示房间已创建");
      }
      setStagedFile(null);
      setReply(null);
      setMessageQuery("");
      nearBottom.current = true;
      setFilter("all");
      setQuery("");
      setModal(null);
      setMobileChat(true);
    });
  }
  async function logout() {
    if (sendLock.current) {
      setError("请先等待发送完成或取消附件上传。");
      return;
    }
    await attempt(async () => {
      let failed = false;
      try {
        await connection.current?.logout();
      } catch {
        failed = true;
      }
      connection.current = null;
      clearSessionUI();
      setAccount(null);
      setLive([]);
      setSelected("design");
      setStatus("本地演示空间");
      setModal(null);
      notify(
        failed
          ? "已清除本次登录；服务器未响应，请在其他客户端撤销此设备。"
          : "已退出 Matrix 账号",
      );
    });
  }
  const togglePin = () =>
    room &&
    setPins((p) =>
      p.includes(room.id) ? p.filter((id) => id !== room.id) : [...p, room.id],
    );
  const renderRooms = (items: ChatRoom[]) =>
    items.map((r) => (
      <button
        key={r.id}
        className={`room-item ${room?.id === r.id ? "selected" : ""}`}
        onClick={() => pickRoom(r.id)}
      >
        <Avatar name={r.name} color={r.color} symbol={r.symbol} />
        <span className="room-item-body">
          <span className="room-item-top">
            <strong>{r.name}</strong>
            <time>
              {r.messages.at(-1) ? timeLabel(r.messages.at(-1)!.time) : ""}
            </time>
          </span>
          <span className="room-item-bottom">
            <span>
              {r.invited
                ? "邀请你加入此房间"
                : r.messages.at(-1)?.text || "来打个招呼吧"}
            </span>
            {r.unread > 0 && <b>{r.unread}</b>}
          </span>
        </span>
      </button>
    ));

  return (
    <div className={`app-shell ${mobileChat ? "mobile-chat" : ""}`}>
      <nav className="rail" aria-label="主导航">
        <img className="brand-mark" src="./ripple.svg" alt="Ripple" />
        <div className="rail-middle">
          <IconButton
            label="全部会话"
            active={filter !== "direct"}
            onClick={() => {
              setFilter("all");
              setMobileChat(false);
            }}
          >
            <MessageCircle size={23} />
            {unread > 0 && <i className="notification-dot" />}
          </IconButton>
          <IconButton
            label="私信"
            active={filter === "direct"}
            onClick={() => {
              setFilter("direct");
              setMobileChat(false);
            }}
          >
            <Users size={23} />
          </IconButton>
          <span className="rail-divider" />
          <button
            className="space-avatar"
            title="当前空间"
            onClick={() => open("settings")}
          >
            R<span />
          </button>
          <IconButton
            label="加入房间"
            onClick={() => {
              setRoomMode("join");
              open("new");
            }}
          >
            <Compass size={23} />
          </IconButton>
          <IconButton
            label="创建房间"
            onClick={() => {
              setRoomMode("create");
              open("new");
            }}
          >
            <Plus size={24} />
          </IconButton>
        </div>
        <div className="rail-bottom">
          <IconButton label="使用帮助" onClick={() => open("help")}>
            <CircleHelp size={21} />
          </IconButton>
          <IconButton label="设置" onClick={() => open("settings")}>
            <Settings size={22} />
          </IconButton>
          <button
            className="self-avatar"
            title={account?.userId || "演示账号"}
            onClick={() => open(account ? "settings" : "login")}
          >
            {account ? account.userId.slice(1, 2).toUpperCase() : "我"}
            <i />
          </button>
        </div>
      </nav>
      <aside className="sidebar">
        <div className="sidebar-heading">
          <div>
            <h1>
              涟漪 <span>Ripple</span>
            </h1>
            <button
              className="workspace-name"
              onClick={() => open(account ? "settings" : "login")}
            >
              {account ? account.userId : "我的灵感空间"}
              <ChevronDown size={13} />
            </button>
          </div>
          <IconButton
            label="新建会话"
            onClick={() => {
              setRoomMode("create");
              open("new");
            }}
          >
            <Plus size={21} />
          </IconButton>
        </div>
        <label className="search-box">
          <Search size={17} />
          <input
            aria-label="搜索会话"
            placeholder="搜索会话…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span>
            <Search size={12} />
          </span>
        </label>
        <div className="filter-tabs">
          <button
            className={filter === "all" ? "chosen" : ""}
            onClick={() => setFilter("all")}
          >
            全部会话
          </button>
          <button
            className={filter === "unread" ? "chosen" : ""}
            onClick={() => setFilter("unread")}
          >
            未读 {unread > 0 && <span>{unread}</span>}
          </button>
          <button
            className={filter === "direct" ? "chosen" : ""}
            onClick={() => setFilter("direct")}
          >
            私信
          </button>
        </div>
        <div className="room-list">
          {visibleRooms.some((r) => pins.includes(r.id)) && (
            <>
              <div className="list-label">
                <Pin size={12} />
                置顶会话
              </div>
              {renderRooms(visibleRooms.filter((r) => pins.includes(r.id)))}
            </>
          )}
          <div className="list-label">
            消息{" "}
            <span>
              {visibleRooms.filter((r) => !pins.includes(r.id)).length}
            </span>
          </div>
          {renderRooms(visibleRooms.filter((r) => !pins.includes(r.id)))}
          {!visibleRooms.length && (
            <div className="list-empty">
              {query
                ? "没有找到匹配的会话"
                : filter === "unread"
                  ? "全部读完啦 ☀"
                  : account
                    ? "暂无会话，创建或加入一个房间吧"
                    : "还没有私信"}
            </div>
          )}
        </div>
        {!account && (
          <button className="connect-card" onClick={() => open("login")}>
            <span className="connect-icon">
              <Sparkles size={18} />
            </span>
            <span>
              <strong>让对话，真正连接</strong>
              <small>连接你的 Matrix 账号</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
        )}
        <div className="connection-status">
          <i className={account ? "online" : ""} />
          {status}
          <span>v0.3.0</span>
        </div>
      </aside>
      <main className="chat-main">
        {room ? (
          <>
            <header className="chat-header">
              <span className="mobile-back">
                <IconButton
                  label="返回会话"
                  onClick={() => setMobileChat(false)}
                >
                  <ArrowLeft size={21} />
                </IconButton>
              </span>
              <Avatar
                name={room.name}
                color={room.color}
                symbol={room.symbol}
                small
              />
              <div className="chat-title">
                <h2>
                  {room.name}
                  {room.encrypted && <LockKeyhole size={14} />}
                </h2>
                <span>
                  {room.invited
                    ? "你收到了加入邀请"
                    : `${room.members.length} 位成员`}
                  <i /> {account ? "Matrix 房间" : "灵感在这里汇合"}
                </span>
              </div>
              <div className="chat-tools">
                <IconButton
                  label="搜索消息"
                  active={searchMessages}
                  onClick={() => {
                    setSearchMessages((v) => !v);
                    setMessageQuery("");
                  }}
                >
                  <Search size={20} />
                </IconButton>
                <IconButton
                  label="房间详情"
                  active={info}
                  onClick={() => setInfo((v) => !v)}
                >
                  <Users size={21} />
                </IconButton>
              </div>
            </header>
            {searchMessages && (
              <div className="message-search">
                <Search size={17} />
                <input
                  autoFocus
                  placeholder="在当前会话中搜索消息或发送者…"
                  aria-label="搜索当前消息"
                  value={messageQuery}
                  onChange={(e) => setMessageQuery(e.target.value)}
                />
                <span>{messages.length} 条</span>
                <IconButton
                  label="关闭搜索"
                  onClick={() => {
                    setSearchMessages(false);
                    setMessageQuery("");
                  }}
                >
                  <X size={17} />
                </IconButton>
              </div>
            )}
            <div className="room-topic">
              <span>
                <Hash size={14} />
                {room.description}
              </span>
              <button onClick={() => setInfo(true)}>
                房间信息
                <ChevronRight size={13} />
              </button>
            </div>
            <div
              className="messages"
              ref={scroll}
              onScroll={() => {
                timeline.onScroll();
                readVisibleRef.current();
              }}
            >
              <div className="messages-content">
                {account &&
                  room.messages.length > 0 &&
                  (room.hasOlder !== false ? (
                    <button
                      className="load-older"
                      disabled={Boolean(loadingHistory)}
                      onClick={loadOlder}
                    >
                      {loadingHistory === room.id
                        ? "正在加载历史…"
                        : "加载更早的消息"}
                    </button>
                  ) : (
                    <p className="history-end">已经到最早的消息了</p>
                  ))}
                {!account && (
                  <div className="timeline-intro">
                    <span>
                      <Asterisk size={23} />
                    </span>
                    <div>
                      <strong>每段好对话，都从这里开始</strong>
                      <p>这是演示空间。随手聊聊，感受涟漪。</p>
                    </div>
                  </div>
                )}
                {messages.map((m, index) => (
                  <div key={m.id}>
                    {(index === 0 ||
                      new Date(m.time).toDateString() !==
                        new Date(messages[index - 1].time).toDateString()) && (
                      <div className="date-separator">
                        <span>
                          {new Date(m.time).toLocaleDateString("zh-CN", {
                            month: "long",
                            day: "numeric",
                            weekday: "long",
                          })}
                        </span>
                      </div>
                    )}
                    <article
                      tabIndex={-1}
                      data-message-id={m.id}
                      className={`message ${m.own ? "own" : ""} ${m.redacted ? "redacted" : ""} ${timeline.highlight === m.id ? "message-highlight" : ""}`}
                    >
                      <Avatar
                        name={m.name}
                        color={
                          m.own
                            ? "purple"
                            : m.sender.includes("summer")
                              ? "peach"
                              : m.sender.includes("zhou")
                                ? "mint"
                                : "blue"
                        }
                        small
                      />
                      <div className="message-content">
                        <div className="message-meta">
                          <strong>{m.name}</strong>
                          <time>{timeLabel(m.time)}</time>
                          {m.edited && !m.redacted && (
                            <small className="edited-label">已编辑</small>
                          )}
                        </div>
                        <div
                          className={`bubble ${m.kind === "image" && !m.redacted ? "attachment-bubble" : ""}`}
                        >
                          {m.reply && !m.redacted && (
                            <button
                              className="quoted-message"
                              aria-label="定位引用消息"
                              onClick={() => {
                                if (!m.replyId || !timeline.locate(m.replyId))
                                  notify(
                                    "原消息尚未加载，请先加载更早的消息。",
                                  );
                              }}
                            >
                              {m.reply}
                            </button>
                          )}
                          {!m.redacted &&
                          (m.kind === "image" || m.kind === "file") ? (
                            <Attachment
                              key={JSON.stringify([
                                account?.baseUrl,
                                account?.userId,
                                m.localFile,
                                m.mediaUri,
                                m.url,
                                m.encryptedFile,
                              ])}
                              message={m}
                              load={
                                account
                                  ? (message, signal) =>
                                      connection.current!.download(
                                        message,
                                        signal,
                                      )
                                  : undefined
                              }
                            />
                          ) : (
                            <p>{m.text}</p>
                          )}
                        </div>
                        {m.own && (
                          <div className="delivery">
                            {m.failed ? (
                              <>
                                <button
                                  onClick={() =>
                                    connection.current
                                      ?.retry(room.id, m.id)
                                      .catch(() =>
                                        notify("重试失败，请检查连接"),
                                      )
                                  }
                                >
                                  发送失败 · 点击重试
                                </button>
                                <button
                                  aria-label="取消失败消息"
                                  onClick={() =>
                                    connection.current?.discard(room.id, m.id)
                                  }
                                >
                                  取消
                                </button>
                              </>
                            ) : m.pending ? (
                              <>
                                <LoaderCircle size={12} className="spin" />
                                发送中
                              </>
                            ) : (
                              <>
                                <CheckCheck size={13} />
                                {account ? "已发送" : "已存入本地演示"}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {!m.redacted && (
                        <div className="message-actions">
                          {m.own && !m.pending && !m.failed && (
                            <>
                              {(!m.kind || m.kind === "text") && (
                                <IconButton
                                  label="编辑消息"
                                  onClick={() => {
                                    setError("");
                                    setEditing(m);
                                    setEditText(m.text);
                                  }}
                                >
                                  <Pencil size={14} />
                                </IconButton>
                              )}
                              <IconButton
                                label="撤回消息"
                                onClick={() => {
                                  setError("");
                                  setRedacting(m);
                                }}
                              >
                                <Trash2 size={14} />
                              </IconButton>
                            </>
                          )}
                          <IconButton
                            label={`回复 ${m.name}`}
                            onClick={() => {
                              if (sendLock.current) return;
                              if (m.pending || m.failed) {
                                notify("请等消息发送成功后再回复。");
                                return;
                              }
                              setStagedFile(null);
                              setReply(m);
                              composer.current?.focus();
                            }}
                          >
                            <Reply size={15} />
                          </IconButton>
                          <IconButton
                            label="复制消息"
                            onClick={() =>
                              copyText(m.text)
                                .then(() => notify("消息已复制"))
                                .catch(() => notify("浏览器未允许剪贴板访问"))
                            }
                          >
                            <Copy size={14} />
                          </IconButton>
                        </div>
                      )}
                    </article>
                  </div>
                ))}
                {!messages.length && (
                  <div className="empty-chat">
                    <MessageCircle size={38} />
                    <h3>{messageQuery ? "没有找到这条消息" : "打个招呼吧"}</h3>
                    <p>
                      {messageQuery
                        ? "试试其他关键词。"
                        : "每一段连接，都从一句「你好」开始。"}
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="composer-area">
              {(timeline.away || timeline.unseen > 0) && !messageQuery && (
                <button className="jump-latest" onClick={timeline.latest}>
                  <ArrowDown size={15} />
                  {timeline.unseen > 0
                    ? `${timeline.unseen} 条新消息 · 回到最新`
                    : "回到最新消息"}
                </button>
              )}
              {account && Boolean(room.typing?.length) && (
                <div className="typing-indicator" role="status">
                  <span className="typing-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>
                    {room.typing!.slice(0, 2).join("、")}
                    {room.typing!.length > 2
                      ? `等 ${room.typing!.length} 人`
                      : ""}{" "}
                    正在输入…
                  </span>
                </div>
              )}
              {room.invited ? (
                <div className="invitation">
                  <p>你被邀请加入「{room.name}」</p>
                  <button
                    className="primary"
                    onClick={() =>
                      attempt(async () => {
                        await connection.current!.join(room.id);
                        notify("已接受邀请");
                      })
                    }
                    disabled={busy}
                  >
                    接受邀请
                  </button>
                  {error && <p className="error">{error}</p>}
                </div>
              ) : (
                <>
                  <div
                    className={`composer ${stagedFile ? "has-file" : ""}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      chooseFile(e.dataTransfer.files[0]);
                    }}
                  >
                    <input
                      ref={fileInput}
                      className="visually-hidden"
                      type="file"
                      aria-label="添加附件"
                      onChange={(e) => {
                        chooseFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    {stagedFile && (
                      <div className="attachment-staging">
                        <FileText size={22} />
                        <div>
                          <strong>{stagedFile.name}</strong>
                          <small>
                            {fileSize(stagedFile.size)} ·{" "}
                            {sending
                              ? `${uploadProgress}% · 正在发送到原会话`
                              : room.encrypted
                                ? "发送前自动加密"
                                : "准备发送"}
                          </small>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={sending ? "取消上传" : "移除附件"}
                          disabled={sending && uploadProgress >= 100}
                          onClick={() => {
                            if (sending) uploadAbort.current?.abort();
                            else setStagedFile(null);
                          }}
                        >
                          <X size={17} />
                        </button>
                        {sending && (
                          <progress value={uploadProgress} max="100" />
                        )}
                      </div>
                    )}
                    {reply && (
                      <div className="reply-preview">
                        <Reply size={16} />
                        <span>
                          回复 {reply.name}
                          <small>{reply.text}</small>
                        </span>
                        <IconButton
                          label="取消回复"
                          onClick={() => setReply(null)}
                        >
                          <X size={15} />
                        </IconButton>
                      </div>
                    )}
                    <textarea
                      ref={composer}
                      aria-label="输入消息"
                      placeholder={`发送消息到 ${room.name}…`}
                      value={draft}
                      maxLength={10000}
                      onChange={(e) => changeDraft(e.target.value)}
                      onBlur={() => {
                        void connection.current?.typing.stop();
                      }}
                      onPaste={(e) => {
                        const file = e.clipboardData.files[0];
                        if (file) {
                          e.preventDefault();
                          chooseFile(file);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <div className="composer-toolbar">
                      <div className="composer-left">
                        <IconButton
                          label="发送图片或文件"
                          onClick={() => {
                            if (!sending) fileInput.current?.click();
                          }}
                        >
                          <Paperclip size={20} />
                        </IconButton>
                        <IconButton
                          label="选择表情"
                          active={emoji}
                          onClick={() => setEmoji((v) => !v)}
                        >
                          <Smile size={21} />
                        </IconButton>
                        <span className="composer-divider" />
                        <span className="format-hint">让想法自然流动…</span>
                      </div>
                      <button
                        className="send-button"
                        aria-label="发送消息"
                        disabled={(!draft.trim() && !stagedFile) || sending}
                        onClick={send}
                      >
                        {sending ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <Send size={17} />
                        )}
                        <span>发送</span>
                      </button>
                    </div>
                    {emoji && (
                      <div className="emoji-picker">
                        {[
                          "😊",
                          "✨",
                          "🌿",
                          "👍",
                          "❤️",
                          "🎉",
                          "☀️",
                          "☕",
                          "👋",
                          "💡",
                          "🙌",
                          "🚀",
                        ].map((value) => (
                          <button
                            key={value}
                            onClick={() => {
                              changeDraft(draft + value);
                              setEmoji(false);
                              composer.current?.focus();
                            }}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="composer-foot">
                    <span>
                      {room.encrypted ? (
                        <>
                          <LockKeyhole size={11} />
                          端到端加密房间
                        </>
                      ) : account ? (
                        "此房间未开启端到端加密"
                      ) : (
                        <>
                          <span className="tiny-ripple">◎</span>
                          演示消息仅保存在此浏览器
                        </>
                      )}
                    </span>
                    <span>Enter 发送 · Shift + Enter 换行</span>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="empty-chat">
            <MessageCircle size={48} />
            <h3>你的对话，从这里开始</h3>
            <p>{status}</p>
            <button className="primary" onClick={() => open("new")}>
              创建或加入房间
            </button>
          </div>
        )}
      </main>
      {info && room && (
        <aside className="details">
          <header>
            <h3>房间详情</h3>
            <IconButton label="收起详情" onClick={() => setInfo(false)}>
              <X size={18} />
            </IconButton>
          </header>
          <div className="room-profile">
            <Avatar name={room.name} symbol={room.symbol} color={room.color} />
            <h2>{room.name}</h2>
            <span className="room-tag">
              {account
                ? room.encrypted
                  ? "加密房间"
                  : "Matrix 房间"
                : "演示群聊"}
            </span>
            <p>{room.description}</p>
          </div>
          <div className="detail-quick-actions">
            <button onClick={togglePin}>
              <span className={pins.includes(room.id) ? "is-pinned" : ""}>
                <Pin size={19} />
              </span>
              {pins.includes(room.id) ? "取消置顶" : "置顶会话"}
            </button>
            <button
              onClick={() =>
                copyText(account ? room.id : room.name)
                  .then(() =>
                    notify(account ? "房间 ID 已复制" : "房间名称已复制"),
                  )
                  .catch(() => notify("浏览器未允许剪贴板访问"))
              }
            >
              <span>
                <Link size={19} />
              </span>
              复制{account ? "地址" : "名称"}
            </button>
            <button onClick={() => open("invite")}>
              <span>
                <Plus size={19} />
              </span>
              邀请好友
            </button>
          </div>
          <div className="detail-section">
            <h4>关于房间</h4>
            <div className="detail-row">
              <Hash size={16} />
              <span>房间类型</span>
              <b>{room.direct ? "私信" : "群聊"}</b>
            </div>
            <div className="detail-row">
              <ShieldCheck size={16} />
              <span>连接方式</span>
              <b>{account ? "Matrix" : "本地演示"}</b>
            </div>
          </div>
          <div className="detail-section members">
            <h4>
              房间成员 <span>{room.members.length}</span>
            </h4>
            {room.members.slice(0, 8).map((m, i) => (
              <div className="member" key={m.id}>
                <Avatar
                  name={m.name}
                  color={["blue", "peach", "mint", "purple"][i % 4]}
                  small
                />
                <span>{m.name}</span>
                {m.id === "me" || m.id === account?.userId ? (
                  <small>你</small>
                ) : null}
              </div>
            ))}
            {room.members.length > 8 && (
              <p className="muted">还有 {room.members.length - 8} 位成员</p>
            )}
          </div>
          <div className="detail-bottom">
            <span className="orbital">◎</span>
            <strong>连接，自在发生。</strong>
            <p>
              由 Matrix 开放协议连接
              <br />
              让每一段对话，都属于你。
            </p>
            <span>RIPPLE MESSENGER</span>
          </div>
        </aside>
      )}
      {modal === "login" && (
        <Modal
          title="连接你的世界"
          subtitle="登录 Matrix 账号，让对话在设备间流动。"
          close={() => !busy && setModal(null)}
        >
          <form onSubmit={connect}>
            <div className="segmented">
              <button
                type="button"
                className={loginMode === "password" ? "chosen" : ""}
                onClick={() => setLoginMode("password")}
              >
                账号密码
              </button>
              <button
                type="button"
                className={loginMode === "token" ? "chosen" : ""}
                onClick={() => setLoginMode("token")}
              >
                访问令牌
              </button>
            </div>
            <label className="field">
              服务器地址
              <input
                name="server"
                type="text"
                defaultValue="https://matrix.org"
                placeholder="https://matrix.example.com"
                required
              />
            </label>
            {loginMode === "password" ? (
              <>
                <label className="field">
                  Matrix 账号
                  <input
                    name="user"
                    autoComplete="username"
                    placeholder="@you:matrix.org"
                    required
                  />
                </label>
                <label className="field">
                  密码
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    placeholder="输入账号密码"
                  />
                </label>
              </>
            ) : (
              <label className="field">
                访问令牌
                <input
                  name="token"
                  type="password"
                  autoComplete="off"
                  required
                  placeholder="输入已有设备的 access token"
                />
              </label>
            )}
            <div className="form-note">
              <LockKeyhole size={16} />
              <p>
                凭据只保留在本次运行的内存中，关闭或刷新后需要重新登录。请勿同时在其他客户端使用同一设备令牌。
              </p>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={17} />
                  正在连接…
                </>
              ) : (
                <>
                  连接 Matrix <ArrowUpRight size={17} />
                </>
              )}
            </button>
            <p className="form-caption">
              需要已有 Matrix 账号。本版本支持密码与令牌登录。
            </p>
          </form>
        </Modal>
      )}
      {modal === "new" && (
        <Modal
          title="开启一段新对话"
          subtitle={
            account
              ? "创建加密房间，或加入已有的 Matrix 房间。"
              : "在演示空间里，为你的灵感开一个房间。"
          }
          close={() => !busy && setModal(null)}
        >
          <form onSubmit={createRoom}>
            <div className="segmented">
              <button
                type="button"
                className={roomMode === "create" ? "chosen" : ""}
                onClick={() => setRoomMode("create")}
              >
                创建房间
              </button>
              <button
                type="button"
                className={roomMode === "join" ? "chosen" : ""}
                onClick={() => setRoomMode("join")}
              >
                加入房间
              </button>
            </div>
            {roomMode === "create" ? (
              <>
                <label className="field">
                  房间名称
                  <input
                    name="name"
                    placeholder="例如：一起造点有趣的"
                    maxLength={80}
                    required
                  />
                </label>
                <label className="field">
                  房间介绍
                  <textarea
                    name="topic"
                    placeholder="聊什么，都可以。"
                    maxLength={300}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  房间地址
                  <input
                    name="address"
                    placeholder="#room:matrix.org 或 !room:server"
                    required
                  />
                </label>
                {!account && (
                  <p className="form-caption">
                    加入真实房间需要先连接 Matrix 账号。
                  </p>
                )}
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy
                ? "正在处理…"
                : roomMode === "create"
                  ? "创建房间"
                  : "加入房间"}
            </button>
            {!account && roomMode === "join" && (
              <button
                type="button"
                className="text-button full"
                onClick={() => open("login")}
              >
                连接 Matrix 账号
              </button>
            )}
          </form>
        </Modal>
      )}
      {modal === "invite" && (
        <Modal
          title="邀请好友"
          subtitle="把有趣的人，聚在一起。"
          close={() => !busy && setModal(null)}
        >
          {account ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const userId = String(
                  new FormData(event.currentTarget).get("user"),
                ).trim();
                void attempt(async () => {
                  await connection.current!.invite(room!.id, userId);
                  setModal(null);
                  notify("邀请已发送");
                });
              }}
            >
              <label className="field">
                好友的 Matrix ID
                <input
                  name="user"
                  placeholder="@friend:matrix.org"
                  pattern="@.+:.+"
                  required
                />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="primary full" disabled={busy}>
                发送邀请
              </button>
            </form>
          ) : (
            <>
              <p className="help-copy">
                这里是本地演示空间。连接 Matrix
                账号后，就能邀请好友加入你的真实房间。
              </p>
              <button className="primary full" onClick={() => open("login")}>
                连接 Matrix 账号
              </button>
            </>
          )}
        </Modal>
      )}
      {modal === "settings" && (
        <Modal
          title="把涟漪调成你的样子"
          subtitle="一点点偏好，让这里更像你。"
          close={() => !busy && setModal(null)}
        >
          <div className="settings-row">
            <div>
              <strong>外观主题</strong>
              <p>选择让眼睛舒服的颜色</p>
            </div>
            <button
              className="theme-toggle"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Sun size={18} /> : <Moon size={18} />}{" "}
              {theme === "light" ? "浅色" : "深色"}
            </button>
          </div>
          <div className="settings-row">
            <div>
              <strong>{account ? "已连接的账号" : "当前为演示模式"}</strong>
              <p className="account-label">
                {account?.userId || "演示消息保存在本机，刷新后仍可查看"}
              </p>
            </div>
            <AtSign size={21} />
          </div>
          {account && (
            <div className="form-note">
              <ShieldCheck size={20} />
              <p>
                加密引擎已启用；此版本尚未提供跨设备验证和历史密钥恢复界面。需要历史密钥的消息请在原客户端查看。
              </p>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {account ? (
            <button className="secondary full" disabled={busy} onClick={logout}>
              <LogOut size={17} />
              退出账号
            </button>
          ) : (
            <button className="primary full" onClick={() => open("login")}>
              连接 Matrix 账号
              <ArrowUpRight size={17} />
            </button>
          )}
          <p className="form-caption">涟漪 Ripple · 0.3.0 · Built on Matrix</p>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="你好，这里是涟漪"
          subtitle="一个让对话自然发生的 Matrix 聊天客户端。"
          close={() => setModal(null)}
        >
          <div className="help-copy">
            <p>
              <strong>先随手聊聊</strong>
              <br />
              演示空间支持发消息、回复、搜索、置顶和创建房间，数据只保存在当前浏览器。
            </p>
            <p>
              <strong>连接真实的朋友</strong>
              <br />
              使用已有 Matrix
              账号登录服务器，即可同步房间、发送文字、接受邀请、邀请好友，以及创建加密房间。
            </p>
            <p>
              <strong>关于第一版</strong>
              <br />
              支持图片与文件附件、编辑和撤回。暂不包含音视频通话、SSO、设备验证及密钥恢复。旧的加密消息可能需要在原客户端查看。
            </p>
          </div>
          <button className="primary full" onClick={() => setModal(null)}>
            开始探索
          </button>
        </Modal>
      )}
      {editing && (
        <Modal
          title="编辑消息"
          subtitle="修改会同步给房间中的其他成员。"
          close={() => !busy && setEditing(null)}
        >
          <form onSubmit={saveEdit}>
            <label className="field">
              消息内容
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                maxLength={10000}
                required
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary full"
              disabled={busy || !editText.trim()}
            >
              {busy ? "保存中…" : "保存修改"}
            </button>
          </form>
        </Modal>
      )}
      {redacting && (
        <Modal
          title="撤回这条消息？"
          subtitle="撤回后其他成员将无法再看到消息正文，但可能已经阅读或保存过。"
          close={() => !busy && setRedacting(null)}
        >
          <p className="redact-preview">
            {redacting.filename || redacting.text}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setRedacting(null)}
            >
              保留消息
            </button>
            <button
              className="primary danger"
              disabled={busy}
              onClick={confirmRedact}
            >
              {busy ? "正在撤回…" : "确认撤回"}
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
