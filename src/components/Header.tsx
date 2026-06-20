/** 顶部状态栏：标题、算法版本、连接状态。 */
import { Bomb, Radio, Wifi, WifiOff } from "lucide-react";
import { ALGO_VERSION } from "@shared/protocol";
import { useGameStore } from "@/store/gameStore";
import { cn } from "@/lib/utils";

export function Header() {
  const connected = useGameStore((s) => s.connected);
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-ink-700 bg-ink-900/60 px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center border border-amber/40 bg-amber/10 text-amber shadow-glow-amber">
          <Bomb className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-lg font-bold tracking-[0.2em] text-zinc-100">
            协同排雷
          </h1>
          <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-zinc-500">
            COOP MINESWEEPER
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="tac-chip">
          <Radio className="h-3 w-3" /> ALGO v{ALGO_VERSION}
        </span>
        <span
          className={cn(
            "tac-chip",
            connected ? "border-emerald/40 text-emerald" : "border-danger/40 text-danger",
          )}
        >
          {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {connected ? "ONLINE" : "OFFLINE"}
        </span>
      </div>
    </header>
  );
}
