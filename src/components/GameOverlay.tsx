/** 结算遮罩：胜利/失败提示 + 房主重开按钮。 */
import { Bomb, RotateCcw, Trophy } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { cn } from "@/lib/utils";

export function GameOverlay() {
  const result = useGameStore((s) => s.result);
  const room = useGameStore((s) => s.room);
  const myId = useGameStore((s) => s.myId);
  const resetGame = useGameStore((s) => s.resetGame);
  if (!result) return null;

  const win = result === "win";
  const me = room?.players.find((p) => p.id === myId);
  const isHost = me?.isHost ?? false;

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-ink-950/70 backdrop-blur-sm">
      <div className="panel w-72 text-center">
        {win ? (
          <Trophy className="mx-auto h-12 w-12 text-emerald drop-shadow-[0_0_12px_var(--tw-shadow-color)]" />
        ) : (
          <Bomb className="mx-auto h-12 w-12 text-danger" />
        )}
        <h2
          className={cn(
            "mt-3 font-display text-2xl tracking-[0.2em]",
            win ? "text-emerald" : "text-danger",
          )}
        >
          {win ? "扫雷成功" : "雷区引爆"}
        </h2>
        <p className="mt-1 font-mono text-xs text-zinc-400">
          {win ? "全部安全格已翻开" : "触雷了，下次小心"}
        </p>
        {isHost ? (
          <button type="button" className="tac-btn-primary mt-4" onClick={resetGame}>
            <RotateCcw className="h-4 w-4" /> 重新开始
          </button>
        ) : (
          <p className="mt-4 font-mono text-xs text-zinc-500">等待房主重新开始…</p>
        )}
      </div>
    </div>
  );
}
