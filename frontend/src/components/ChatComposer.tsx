import React, { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import { useSse } from "../contexts/SseContext";
import ModelChip from "./ModelChip";

interface ChatComposerProps {
  isLoading: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  focusKey?: number;
}

export default function ChatComposer({
  isLoading,
  onSend,
  onStop,
  focusKey,
}: ChatComposerProps) {
  const { uploadAction, csrfToken, uploadDir } = useSse();

  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      imageUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // Focus the composer on mount and whenever focusKey changes (e.g. "New Chat" clicked)
  useEffect(() => {
    textareaRef.current?.focus();
  }, [focusKey]);

  // Refocus when the loading state clears (streaming finished) so the user can keep typing
  useEffect(() => {
    if (!isLoading) {
      textareaRef.current?.focus();
    }
  }, [isLoading]);

  // Global Esc key handler — textarea is disabled during streaming, so onKeyDown won't fire
  useEffect(() => {
    if (!isLoading) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onStop();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isLoading, onStop]);

  const busy = isLoading || uploading;
  const blocked = busy;

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      setPendingFiles((prev) => [...prev, ...files]);
      // Create preview URLs for any image files
      setImageUrls((prev) => {
        const next = new Map(prev);
        files.forEach((f) => {
          if (f.type.startsWith("image/")) {
            next.set(f.name + "-" + f.size, URL.createObjectURL(f));
          }
        });
        return next;
      });
      e.target.value = "";
    },
    [],
  );

  const removeFile = useCallback((idx: number) => {
    setPendingFiles((prev) => {
      const file = prev[idx];
      if (file && file.type.startsWith("image/")) {
        const key = file.name + "-" + file.size;
        setImageUrls((urls) => {
          const next = new Map(urls);
          const url = next.get(key);
          if (url) URL.revokeObjectURL(url);
          next.delete(key);
          return next;
        });
      }
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;
    if (blocked || uploading) return;

    let finalText = text;

    if (pendingFiles.length > 0 && uploadAction) {
      setUploading(true);
      const uploadedPaths: string[] = [];
      for (const file of pendingFiles) {
        const formData = new FormData();
        formData.append(
          "path",
          uploadDir.replace(/\/$/, "") + "/" + file.name.replace(/[/\\]/g, "_"),
        );
        formData.append("file", file);
        try {
          const res = await fetch(uploadAction, {
            method: "POST",
            headers: { "x-csrf-token": csrfToken },
            body: formData,
          });
          if (res.ok)
            uploadedPaths.push(
              uploadDir.replace(/\/$/, "") +
                "/" +
                file.name.replace(/[/\\]/g, "_"),
            );
        } catch (err) {
          console.error("File upload failed", err);
        }
      }
      setUploading(false);
      if (uploadedPaths.length > 0) {
        const note = uploadedPaths.map((p) => `Uploaded file: ${p}`).join("\n");
        finalText = finalText ? `${finalText}\n\n${note}` : note;
      }
      setPendingFiles([]);
    }

    if (!finalText) return;

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    textareaRef.current?.focus();
    onSend(finalText);
  }, [
    input,
    blocked,
    uploading,
    pendingFiles,
    uploadAction,
    csrfToken,
    uploadDir,
    onSend,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = "auto";
    target.style.height = Math.min(target.scrollHeight, 260) + "px";
    setInput(target.value);
  }, []);

  return (
    <div className="flex-shrink-0 border-t border-border bg-card/60 px-3 pb-3 pt-2">
      <div className="mx-auto max-w-3xl">
        <div className="relative">
          {/* Pending file chips */}
          {pendingFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingFiles.map((file, i) => {
                const imgKey = file.name + "-" + file.size;
                const thumbUrl = file.type.startsWith("image/") ? imageUrls.get(imgKey) : undefined;
                return (
                  <span
                    key={file.name + "-" + i}
                    className="flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-sm text-foreground"
                  >
                    {thumbUrl ? (
                      <img src={thumbUrl} alt="" className="h-5 w-5 rounded object-cover" />
                    ) : (
                      <Paperclip className="h-2.5 w-2.5 text-muted-foreground" />
                    )}
                    <span className="max-w-[160px] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="ml-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Input row */}
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3 py-2 shadow-sm focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
            {/* File upload button */}
            <button
              type="button"
              title="Attach file"
              onClick={() => fileInputRef.current?.click()}
              disabled={blocked}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />

            <textarea
              ref={textareaRef}
              value={input}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Message Claude…"
              disabled={blocked}
              rows={1}
              className="max-h-[260px] min-h-[32px] flex-1 resize-none bg-transparent py-[5px] text-base leading-snug text-foreground placeholder-muted-foreground/50 focus:outline-none disabled:opacity-60"
              style={{ height: "32px" }}
            />

            <ModelChip />

            {uploading ? (
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-muted">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-primary" />
              </div>
            ) : busy ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop (Esc)"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground hover:opacity-90"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={
                  blocked || (!input.trim() && pendingFiles.length === 0)
                }
                title="Send"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
