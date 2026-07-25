/**
 * Full-emoji picker popup built on @emoji-mart/react.
 * Pass `anchor` (a DOMRect from the trigger button) and it will position itself
 * intelligently — above or below, clamped to viewport edges.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";

interface EmojiPickerPopupProps {
  anchor: DOMRect;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const PICKER_W = 352;
const PICKER_H = 440;

export default function EmojiPickerPopup({ anchor, onSelect, onClose }: EmojiPickerPopupProps) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside pointer-down
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Slight delay so the opening click doesn't immediately close it
    const id = window.setTimeout(() => document.addEventListener("mousedown", handle), 50);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handle);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Clamp horizontal: try to align left edge with button, but stay in viewport
  const left = Math.max(8, Math.min(anchor.left, vw - PICKER_W - 8));

  // Prefer opening above when there isn't enough room below
  const spaceBelow = vh - anchor.bottom;
  const above = spaceBelow < PICKER_H + 8 && anchor.top > PICKER_H + 8;
  const top = above ? anchor.top - PICKER_H - 8 : anchor.bottom + 8;

  return createPortal(
    <div
      ref={wrapRef}
      style={{ position: "fixed", top, left, zIndex: 9999 }}
      className="animate-in fade-in zoom-in-95 duration-150 origin-bottom"
    >
      <Picker
        data={data}
        theme="dark"
        previewPosition="none"
        skinTonePosition="none"
        maxFrequentRows={2}
        perLine={Math.floor(Math.min(PICKER_W, vw - 16) / 44)}
        onEmojiSelect={(e: { native: string }) => {
          onSelect(e.native);
          onClose();
        }}
      />
    </div>,
    document.body,
  );
}
