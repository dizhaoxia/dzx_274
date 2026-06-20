/** 邀请码卡片：展示 6 位邀请码、难度、状态、哈希校验。 */
import { Check, Copy, ShieldCheck, Ticket } from "lucide-react";
import { useState } from "react";
import { DIFFICULTY_LABELS } from "@shared/protocol";
import { useGameStore } from "@/store/gameStore";

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ink-700 bg-ink-900/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-zinc-200">{value}</div>
    </div>
  );
}

export function InviteCard() {
  const room = useGameStore((s) => s.room);
  const hashVerified = useGameStore((s) => s.hashVerified);
  const [copied, setCopied] = useState(false);
  if (!room) return null;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const statusLabel =
    room.status === "waiting" ? "等待中" : room.status === "playing" ? "进行中" : "已结束";

  return (
    <div className="panel">
      <div className="flex items-center gap-2 text-zinc-400">
        <Ticket className="h-4 w-4 text-amber" />
        <span className="font-display text-sm tracking-widest">邀请码</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="font-mono text-3xl font-bold tracking-[0.4em] text-amber shadow-glow-amber">
          {room.code}
        </span>
        <button type="button" className="tac-btn" onClick={copy}>
          {copied ? (
            <Check className="h-4 w-4 text-emerald" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs">
        <Info label="难度" value={DIFFICULTY_LABELS[room.difficulty]} />
        <Info label="状态" value={statusLabel} />
        <Info label="哈希" value={hashVerified ? "VERIFIED" : "—"} />
      </div>
      {hashVerified && (
        <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-emerald">
          <ShieldCheck className="h-3.5 w-3.5" />
          雷位哈希校验通过
        </p>
      )}
    </div>
  );
}
