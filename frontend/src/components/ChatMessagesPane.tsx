import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import { ChevronDown } from "lucide-react";
import type { ChatMessage } from "../types";
import MessageComponent from "./MessageComponent";
import MessageCopyControl from "./MessageCopyControl";
import MessageErrorBoundary from "./MessageErrorBoundary";
import MessageSearch from "./MessageSearch";

interface ChatMessagesPaneProps {
  messages: ChatMessage[];
  isLoading: boolean;
  autoScrollToBottom?: boolean;
  showThinking?: boolean;
  autoExpandTools?: boolean;
}

/** A "turn group" is a sequence of assistant + tool messages between user messages. */
type TurnGroup =
  | { kind: "user" | "error"; message: ChatMessage }
  | { kind: "assistant-turn"; messages: ChatMessage[]; firstTimestamp: number };

function groupIntoTurns(messages: ChatMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let currentTurn: ChatMessage[] | null = null;

  const flushTurn = () => {
    if (currentTurn && currentTurn.length > 0) {
      groups.push({
        kind: "assistant-turn",
        messages: currentTurn,
        firstTimestamp: currentTurn[0].timestamp,
      });
      currentTurn = null;
    }
  };

  for (const msg of messages) {
    if (msg.type === "assistant" || msg.type === "tool") {
      if (!currentTurn) currentTurn = [];
      currentTurn.push(msg);
    } else {
      flushTurn();
      const kind = msg.type === "user" ? "user" : "error";
      groups.push({ kind, message: msg });
    }
  }
  flushTurn();
  return groups;
}

const AssistantTurnCard = React.memo(function AssistantTurnCard({
  messages,
  showThinking,
  autoExpandTools,
}: {
  messages: ChatMessage[];
  showThinking?: boolean;
  autoExpandTools?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  const formattedTime = new Date(firstMsg.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Total turn duration (only show after turn completes with multiple messages)
  const turnDurationMs = messages.length > 1 ? lastMsg.timestamp - firstMsg.timestamp : 0;
  const turnDurationSec = Math.floor(turnDurationMs / 1000);

  // Concatenate all assistant text content in this turn for the copy button
  const fullText = messages
    .filter(
      (m) => m.type === "assistant" && !("isThinking" in m && m.isThinking),
    )
    .map((m) => m.content)
    .join("\n\n");

  return (
    <div
      data-testid="assistant-card"
      className="mx-4 my-2.5 rounded-2xl bg-card px-5 py-5 shadow-lg shadow-black/8 ring-1 ring-border/40"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Card header */}
      <div className="mb-3.5 flex items-center gap-2.5">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold tracking-wider text-primary-foreground shadow-sm shadow-primary/20">
          AI
        </div>
        <span className="text-sm font-semibold text-foreground">Claude</span>
        <span className="text-xs text-muted-foreground/50">
          {formattedTime}
        </span>
        {turnDurationSec >= 2 && (
          <span className="tabular-nums text-xs text-muted-foreground/30">
            · {turnDurationSec < 60 ? `${turnDurationSec}s` : `${Math.floor(turnDurationSec / 60)}m ${turnDurationSec % 60}s`}
          </span>
        )}
        {hovered && fullText && (
          <span className="fade-in">
            <MessageCopyControl content={fullText} messageType="assistant" />
          </span>
        )}
      </div>

      {/* Card body — all messages in this turn */}
      <div className="space-y-1">
        {messages.map((msg) => (
          <MessageErrorBoundary key={msg.id}>
            <MessageComponent
              message={msg}
              prevMessage={null}
              insideCard
              showThinking={showThinking}
              autoExpandTools={autoExpandTools}
            />
          </MessageErrorBoundary>
        ))}
      </div>
    </div>
  );
});

export default function ChatMessagesPane({
  messages,
  isLoading,
  autoScrollToBottom,
  showThinking,
  autoExpandTools,
}: ChatMessagesPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const rafRef = useRef<number | null>(null);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCurrent, setSearchCurrent] = useState(0);

  const searchMatches = useMemo(() => {
    if (!searchQuery) return [] as number[];
    const q = searchQuery.toLowerCase();
    const indices: number[] = [];
    messages.forEach((m, i) => {
      if (m.content && m.content.toLowerCase().includes(q)) {
        indices.push(i);
      }
    });
    return indices;
  }, [messages, searchQuery]);

  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    setSearchCurrent((c) => (c + 1) % searchMatches.length);
  }, [searchMatches.length]);

  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return;
    setSearchCurrent((c) => (c - 1 + searchMatches.length) % searchMatches.length);
  }, [searchMatches.length]);

  // Scroll to current match
  useEffect(() => {
    if (searchMatches.length === 0 || !scrollRef.current) return;
    const idx = searchMatches[searchCurrent];
    const el = scrollRef.current.querySelector(`[data-msg-idx="${idx}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [searchCurrent, searchMatches]);

  // Message selection state
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());

  // Ctrl+F and Esc handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape" && selectedMsgIds.size > 0) {
        setSelectedMsgIds(new Set());
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedMsgIds.size]);

  const toggleSelect = useCallback((msgId: string, ctrlKey: boolean) => {
    if (!ctrlKey) return;
    setSelectedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }, []);

  const copySelected = useCallback(() => {
    const selected = messages.filter((m) => selectedMsgIds.has(m.id));
    const text = selected
      .map((m) => {
        const role = m.type === "user" ? "User" : m.type === "assistant" ? "Claude" : m.type;
        return `${role}: ${m.content}`;
      })
      .join("\n\n");
    navigator.clipboard.writeText(text);
    setSelectedMsgIds(new Set());
  }, [messages, selectedMsgIds]);

  const turnGroups = useMemo(() => groupIntoTurns(messages), [messages]);

  useEffect(() => {
    if (autoScrollToBottom === false) return;
    if (userScrolledRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, isLoading]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      userScrolledRef.current = !atBottom;
      setShowScrollBtn(!atBottom);
    });
  }, []);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    userScrolledRef.current = false;
    setShowScrollBtn(false);
  };

  if (messages.length === 0 && !isLoading) {
    return (
      <div
        ref={scrollRef}
        className="flex flex-1 items-center justify-center overflow-y-auto"
      >
        <div className="fade-in flex flex-col items-center gap-3">
          <div className="relative">
            <div className="pulse-glow absolute -inset-3 rounded-full bg-primary/20 blur-xl" />
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-sm font-bold tracking-wider text-primary-foreground shadow-lg shadow-primary/25">
              AI
            </div>
          </div>
          <p className="text-lg font-semibold text-foreground">Welcome back!</p>
          <p className="text-sm text-muted-foreground/60">
            What shall we explore today?
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Search bar */}
      {searchOpen && (
        <div className="absolute inset-x-0 top-0 z-20">
          <MessageSearch
            onSearch={(q) => { setSearchQuery(q); setSearchCurrent(0); }}
            matchCount={searchMatches.length}
            currentMatch={searchCurrent}
            onNext={handleSearchNext}
            onPrev={handleSearchPrev}
            onClose={() => { setSearchOpen(false); setSearchQuery(""); }}
          />
        </div>
      )}
      {/* Top gradient overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background to-transparent" />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full space-y-1 overflow-y-auto py-4"
      >
        <div className="mx-auto max-w-4xl">
          {turnGroups.map((group, i) => {
            if (group.kind === "assistant-turn") {
              // Find message indices for search highlighting
              const msgIndices = group.messages.map((m) => messages.indexOf(m));
              const isHighlighted = searchQuery && msgIndices.some((idx) => searchMatches.includes(idx));
              return (
                <div
                  key={`turn-${group.messages[0].id}`}
                  className="message-slide-in"
                  data-msg-idx={msgIndices[0]}
                >
                  <div className={isHighlighted ? "ring-2 ring-yellow-500/30 rounded-xl" : ""}>
                    <AssistantTurnCard
                      messages={group.messages}
                      showThinking={showThinking}
                      autoExpandTools={autoExpandTools}
                    />
                  </div>
                </div>
              );
            }
            const msg = group.message;
            const msgIdx = messages.indexOf(msg);
            const isHighlighted = searchQuery && searchMatches.includes(msgIdx);
            const isSelected = selectedMsgIds.has(msg.id);
            return (
              <div
                key={msg.id}
                className="message-slide-in"
                data-msg-idx={msgIdx}
                onClick={(e) => toggleSelect(msg.id, e.ctrlKey || e.metaKey)}
              >
                <div className={`${isHighlighted ? "ring-2 ring-yellow-500/30 rounded-xl" : ""} ${isSelected ? "ring-2 ring-primary/40 rounded-xl bg-primary/5" : ""}`}>
                  <MessageErrorBoundary>
                    <MessageComponent
                      message={msg}
                      prevMessage={null}
                      showThinking={showThinking}
                      autoExpandTools={autoExpandTools}
                    />
                  </MessageErrorBoundary>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Bottom gradient overlay */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-background to-transparent" />

      {/* Message selection action bar */}
      {selectedMsgIds.size > 0 && (
        <div className="absolute bottom-12 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-xl">
          <span className="text-xs text-muted-foreground">
            {selectedMsgIds.size} selected
          </span>
          <button
            type="button"
            onClick={copySelected}
            className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => setSelectedMsgIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      {showScrollBtn && (
        <button
          type="button"
          onClick={scrollToBottom}
          title="Scroll to bottom"
          className="scale-in absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
