import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  ImageIcon,
  LoaderCircle,
  X,
  ZoomIn,
} from "lucide-react";
import type { Message } from "./types";
import {
  downloadBlob,
  fileSize,
  isPreviewImage,
  loadLocalFile,
} from "./attachments";
export default function Attachment({
  message,
  load,
}: {
  message: Message;
  load?: (message: Message, signal: AbortSignal) => Promise<Blob>;
}) {
  const [url, setUrl] = useState(message.url || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const objectUrl = useRef("");
  const blob = useRef<Blob | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const running = useRef(false);
  const opener = useRef<HTMLButtonElement>(null);
  const controller = useRef(new AbortController());
  const picture =
    message.kind === "image" &&
    (isPreviewImage(message.mimetype) || Boolean(message.url));
  useEffect(() => {
    mounted.current = true;
    generation.current++;
    running.current = false;
    controller.current = new AbortController();
    return () => {
      mounted.current = false;
      generation.current++;
      running.current = false;
      controller.current.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  async function obtain(epoch: number, signal: AbortSignal) {
    if (blob.current) return blob.current;
    const value = message.localFile
      ? await loadLocalFile(message.localFile)
      : load
        ? await load(message, signal)
        : null;
    if (!value) throw new Error("附件暂时无法读取。");
    if (!mounted.current || generation.current !== epoch || signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    blob.current = value;
    return value;
  }
  async function action(download = false) {
    if (running.current) return;
    running.current = true;
    const epoch = generation.current,
      signal = controller.current.signal;
    setBusy(true);
    setError("");
    try {
      const value = await obtain(epoch, signal);
      if (download) downloadBlob(value, message.filename || message.text);
      else {
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(value);
        setUrl(objectUrl.current);
      }
    } catch (e) {
      if (
        mounted.current &&
        generation.current === epoch &&
        (e as Error).name !== "AbortError"
      )
        setError((e as Error).message);
    } finally {
      if (mounted.current && generation.current === epoch) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (picture && message.localFile) void action();
  }, [message.localFile]);
  useEffect(() => {
    if (!expanded) return;
    const previous = opener.current;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      previous?.focus();
    };
  }, [expanded]);
  return (
    <div className="attachment-message">
      {picture && url ? (
        <button
          ref={opener}
          className="image-open"
          aria-label="放大图片"
          onClick={() => setExpanded(true)}
        >
          <img
            src={url}
            alt={message.filename || message.text}
            onError={() => {
              setError("图片无法解码，请下载后查看。");
              setUrl("");
            }}
          />
          <span>
            <ZoomIn size={16} />
            查看原图
          </span>
        </button>
      ) : (
        <div className="file-card">
          {picture ? <ImageIcon size={28} /> : <FileText size={28} />}
          <div>
            <strong>{message.filename || message.text}</strong>
            <small>
              {fileSize(message.size)}
              {message.encryptedFile ? " · 加密附件" : ""}
            </small>
          </div>
        </div>
      )}
      <div className="attachment-controls">
        {!message.url && (
          <button disabled={busy} onClick={() => action(true)}>
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Download size={14} />
            )}
            下载附件
          </button>
        )}
        {picture && !url && (
          <button disabled={busy} onClick={() => action()}>
            加载图片
          </button>
        )}
      </div>
      {message.text !== message.filename && !message.url && (
        <p className="attachment-caption">{message.text}</p>
      )}
      {error && (
        <p className="attachment-error" role="alert">
          {error}
        </p>
      )}
      {expanded && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setExpanded(false)}
        >
          <button
            autoFocus
            aria-label="关闭图片预览"
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                e.currentTarget.focus();
              }
            }}
          >
            <X size={26} />
          </button>
          <img
            src={url}
            alt={message.filename || message.text}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
