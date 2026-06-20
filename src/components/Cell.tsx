/** 单格：左键翻开、右键标旗/问号、双击 Chord、移动端长按标旗。 */
import { Bomb, Flag, HelpCircle } from "lucide-react";
import type { CellState } from "@shared/protocol";
import { useGameStore } from "@/store/gameStore";
import { cn } from "@/lib/utils";

const NUMBER_CLASS = [
  "",
  "text-sky-400",
  "text-emerald",
  "text-amber",
  "text-fuchsia-400",
  "text-danger",
  "text-cyan-400",
  "text-zinc-200",
  "text-zinc-400",
];

interface CellProps {
  row: number;
  col: number;
  state: CellState;
  adjacent: number;
  isMine: boolean;
  exploded: boolean;
  pending: boolean;
  disabled: boolean;
  size: number;
}

export function Cell({
  row,
  col,
  state,
  adjacent,
  isMine,
  exploded,
  pending,
  disabled,
  size,
}: CellProps) {
  const reveal = useGameStore((s) => s.reveal);
  const flag = useGameStore((s) => s.flag);
  const chord = useGameStore((s) => s.chord);

  const revealed = state === "revealed";
  const mineVisible = revealed && isMine;

  const baseCls =
    "relative grid select-none place-items-center border font-mono font-bold transition-colors duration-75";

  let visual = "border-ink-700 bg-ink-800 text-zinc-300 hover:border-amber/60 hover:bg-ink-700";
  if (revealed) {
    visual = mineVisible
      ? exploded
        ? "border-danger bg-danger/25 text-danger shadow-glow-danger"
        : "border-amber/40 bg-amber/10 text-amber"
      : "border-ink-800 bg-ink-950/60";
  } else if (state === "flagged") {
    visual = "border-amber/60 bg-amber/10 text-amber hover:bg-amber/15";
  } else if (state === "question") {
    visual = "border-ink-600 bg-ink-800 text-zinc-400 hover:border-amber/60";
  }

  return (
    <button
      type="button"
      aria-label={`cell ${row}-${col}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      className={cn(baseCls, visual, pending && "ring-1 ring-amber/50 animate-pulseGlow")}
      onClick={() => {
        if (disabled) return;
        if (!revealed) reveal(row, col);
      }}
      onDoubleClick={() => {
        if (disabled) return;
        if (revealed) chord(row, col);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (disabled || revealed) return;
        flag(row, col);
      }}
      onPointerDown={(e) => {
        if (disabled || revealed) return;
        const timer = window.setTimeout(() => {
          flag(row, col);
          if (navigator.vibrate) navigator.vibrate(15);
        }, 380);
        const cancel = (): void => window.clearTimeout(timer);
        e.currentTarget.addEventListener("pointerup", cancel, { once: true });
        e.currentTarget.addEventListener("pointerleave", cancel, { once: true });
      }}
    >
      {mineVisible ? (
        <Bomb className="h-[55%] w-[55%]" />
      ) : revealed && adjacent > 0 ? (
        <span className={NUMBER_CLASS[adjacent] ?? "text-zinc-300"}>{adjacent}</span>
      ) : state === "flagged" ? (
        <Flag className="h-[55%] w-[55%]" />
      ) : state === "question" ? (
        <HelpCircle className="h-[55%] w-[55%]" />
      ) : null}
    </button>
  );
}
