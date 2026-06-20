/** 状态栏：剩余雷数、服务端权威计时、同步指示、待 ACK 计数、暂停控制、版本号。 */
import { Bomb, Loader2, Pause, Play, ShieldAlert, ShieldCheck, Timer, GitBranch } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/utils";

function format(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  const cs = Math.floor((ms % 1000) / 10).toString().padStart(2, "0");
  return `${m}:${s}.${cs}`;
}

export function StatusBar() {
  const now = useNow(50);
  const config = useGameStore((s) => s.config);
  const flags = useGameStore((s) => s.flags);
  const isPaused = useGameStore((s) => s.isPaused);
  const globalVersion = useGameStore((s) => s.globalVersion);
  const stateVersion = useGameStore((s) => s.stateVersion);
  const lastSyncAt = useGameStore((s) => s.timeSync.lastSyncAt);
  const oneWayDelay = useGameStore((s) => s.timeSync.oneWayDelay);
  const pendingOps = useGameStore((s) => s.pendingOps);
  const getSmoothedElapsed = useGameStore((s) => s.getSmoothedElapsed);
  const pauseGame = useGameStore((s) => s.pauseGame);
  const resumeGame = useGameStore((s) => s.resumeGame);
  const room = useGameStore((s) => s.room);
  const myId = useGameStore((s) => s.myId);

  if (!config) return null;

  let flagged = 0;
  flags.forEach((st) => {
    if (st === "flagged") flagged++;
  });
  const remaining = Math.max(0, config.mineCount - flagged);
  const elapsed = getSmoothedElapsed(now);
  const syncAge = lastSyncAt ? now - lastSyncAt : Infinity;
  const inSync = syncAge < 1000;
  const versionMatch = stateVersion === globalVersion;

  const me = room?.players.find((p) => p.id === myId);
  const isHost = me?.isHost ?? false;
  const canControl = isHost && (room?.status === "playing" || room?.status === "paused");

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-ink-700 bg-ink-900/60 px-4 py-2 font-mono text-sm">
      <span className="flex items-center gap-1.5 text-amber">
        <Bomb className="h-4 w-4" />
        {String(remaining).padStart(3, "0")}
      </span>
      <span className="h-4 w-px bg-ink-700" />
      <span className={cn("flex items-center gap-1.5", isPaused ? "text-amber" : "text-emerald")}>
        <Timer className={cn("h-4 w-4", isPaused && "animate-pulse")} />
        {isPaused && <span className="text-[10px]">[暂停]</span>}
        {format(elapsed)}
      </span>
      <span className="h-4 w-px bg-ink-700" />
      <span className={cn("flex items-center gap-1.5", inSync ? "text-emerald" : "text-amber")}>
        {inSync ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        <span className="text-[10px]">
          {inSync ? `SYNC ${Math.round(oneWayDelay)}ms` : "OUT OF SYNC"}
        </span>
      </span>
      <span className="h-4 w-px bg-ink-700" />
      <span className={cn("flex items-center gap-1 text-[10px]", versionMatch ? "text-zinc-500" : "text-amber")}>
        <GitBranch className="h-3 w-3" />
        v{stateVersion}/{globalVersion}
      </span>
      {canControl && (
        <button
          type="button"
          className={cn(
            "ml-auto flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors",
            isPaused
              ? "border-emerald/50 text-emerald hover:bg-emerald/10"
              : "border-amber/50 text-amber hover:bg-amber/10"
          )}
          onClick={isPaused ? resumeGame : pauseGame}
        >
          {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          {isPaused ? "继续" : "暂停"}
        </button>
      )}
      {pendingOps.size > 0 && !canControl && (
        <span className="ml-auto flex items-center gap-1.5 animate-pulseGlow text-amber">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">等待 ACK ×{pendingOps.size}</span>
        </span>
      )}
    </div>
  );
}
