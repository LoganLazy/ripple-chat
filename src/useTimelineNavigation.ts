import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ChatRoom } from "./types";

export function useTimelineNavigation(
  room: ChatRoom | undefined,
  session: string,
  query: string,
  clearQuery: () => void,
  scroll: RefObject<HTMLDivElement | null>,
  nearBottom: RefObject<boolean>,
) {
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [destination, setDestination] = useState<{
    room: string;
    id?: string;
  } | null>(null);
  const previous = useRef<{ key: string; last?: string }>({ key: "" });
  const key = `${session}/${room?.id}`;
  useEffect(() => {
    const last = room?.messages.at(-1)?.id;
    const before = previous.current;
    previous.current = { key, last };
    if (before.key !== key) {
      setUnseen([]);
      setHighlight(null);
      setAway(false);
      return;
    }
    if (!nearBottom.current && before.last && before.last !== last) {
      const index = room?.messages.findIndex((m) => m.id === before.last) ?? -1;
      if (index >= 0) {
        const added = room!.messages
          .slice(index + 1)
          .filter((m) => !m.own && !m.redacted);
        if (added.length)
          setUnseen((ids) => [...new Set([...ids, ...added.map((m) => m.id)])]);
      }
    }
  }, [room?.messages, key]);
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(timer);
  }, [highlight]);
  function onScroll() {
    const el = scroll.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    nearBottom.current = bottom;
    setAway(!bottom);
    if (bottom && !query) setUnseen((ids) => (ids.length ? [] : ids));
  }
  useLayoutEffect(() => {
    if (!destination || query || destination.room !== room?.id) return;
    const el = scroll.current;
    if (!el) return;
    if (destination.id) {
      const target = [
        ...el.querySelectorAll<HTMLElement>("[data-message-id]"),
      ].find((item) => item.dataset.messageId === destination.id);
      if (target) {
        el.scrollTo({
          top:
            el.scrollTop +
            target.getBoundingClientRect().top -
            el.getBoundingClientRect().top -
            (el.clientHeight - target.offsetHeight) / 2,
          behavior: "instant",
        });
        setHighlight(destination.id);
        target.focus({ preventScroll: true });
      }
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
      setUnseen([]);
      setHighlight(null);
    }
    onScroll();
    setDestination(null);
  }, [destination, query, room?.id]);
  function latest() {
    if (!room) return;
    nearBottom.current = true;
    clearQuery();
    setDestination({ room: room.id });
  }
  function locate(id: string) {
    if (!room?.messages.some((m) => m.id === id)) return false;
    nearBottom.current = false;
    clearQuery();
    setDestination({ room: room.id, id });
    return true;
  }
  return { away, unseen: unseen.length, highlight, onScroll, latest, locate };
}
