/** 状态栏：剩余雷数、服务端权威计时、同步指示、待 ACK 计数。 */
import { Bomb, Loader2, ShieldAlert, ShieldCheck, Timer } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/utils";

function format(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function StatusBar() {
  const now = useNow(250);
  const config = useGameStore((s) => s.config);
  const flags = useGameStore((s) => s.flags);
  const gameStartTimestamp = useGameStore((s) => s.gameStartTimestamp);
  const serverOffset = useGameStore((s) => s.serverOffset);
  const lastSyncAt = useGameStore((s) => s.lastSyncAt);
  const pendingOps = useGameStore((s) => s.pendingOps);

  if (!config) return null;

  let flagged = 0;
  flags.forEach((st) => {
    if (st === "flagged") flagged++;
  });
  const remaining = Math.max(0, config.mineCount - flagged);
  const elapsed = gameStartTimestamp ? now + serverOffset - gameStartTimestamp : 0;
  const syncAge = lastSyncAt ? now - lastSyncAt : Infinity;
  const inSync = syncAge < 2500;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-ink-700 bg-ink-900/60 px-4 py-2 font-mono text-sm">
      <span className="flex items-center gap-1.5 text-amber">
        <Bomb className="h-4 w-4" />
        {String(remaining).padStart(3, "0")}
      </span>
      <span className="h-4 w-px bg-ink-700" />
      <span className="flex items-center gap-1.5 text-emerald">
        <Timer className="h-4 w-4" />
        {format(elapsed)}
      </span>
      <span className="h-4 w-px bg-ink-700" />
      <span className={cn("flex items-center gap-1.5", inSync ? "text-emerald" : "text-amber")}>
        {inSync ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        {inSync ? "TIME SYNC" : "SYNC DELAY"}
      </span>
      {pendingOps.size > 0 && (
        <span className="ml-auto flex items-center gap-1.5 animate-pulseGlow text-amber">
          <Loader2 className="h-4 w-4 animate-spin" />
          等待 ACK ×{pendingOps.size}
        </span>
      )}
    </div>
  );
}
