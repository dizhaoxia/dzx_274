/** 玩家列表：区分房主、准备状态与本人。 */
import { Check, Crown, Minus, User } from "lucide-react";
import type { PlayerSnapshot } from "@shared/protocol";
import { useGameStore } from "@/store/gameStore";
import { cn } from "@/lib/utils";

export function PlayerList() {
  const room = useGameStore((s) => s.room);
  const myId = useGameStore((s) => s.myId);
  if (!room) return null;

  return (
    <div className="space-y-1">
      {room.players.map((p) => (
        <PlayerRow key={p.id} p={p} me={p.id === myId} />
      ))}
    </div>
  );
}

function PlayerRow({ p, me }: { p: PlayerSnapshot; me: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border px-3 py-2 font-display text-sm transition-colors",
        p.ready
          ? "border-emerald/40 bg-emerald/5 text-emerald"
          : "border-ink-700 bg-ink-800/40 text-zinc-300",
        me && "ring-1 ring-amber/40",
      )}
    >
      <span className="flex items-center gap-2">
        {p.isHost ? (
          <Crown className="h-4 w-4 text-amber" />
        ) : (
          <User className="h-4 w-4 text-zinc-500" />
        )}
        <span className="font-medium">{p.name || "匿名玩家"}</span>
        {me && <span className="tac-chip border-amber/40 text-amber">YOU</span>}
      </span>
      <span
        className={cn(
          "flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider",
          p.ready ? "text-emerald" : "text-zinc-500",
        )}
      >
        {p.ready ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        {p.ready ? "READY" : "IDLE"}
      </span>
    </div>
  );
}
