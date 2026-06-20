/** 结算遮罩：胜利/失败提示 + 房主重开选项（同种子复盘/新种子。 */
import { Bomb, RotateCcw, Trophy, RefreshCw, Shuffle } from "lucide-react";
import { useState } from "react";
import { useGameStore } from "@/store/gameStore";
import { cn } from "@/lib/utils";

export function GameOverlay() {
  const result = useGameStore((s) => s.result);
  const room = useGameStore((s) => s.room);
  const config = useGameStore((s) => s.config);
  const myId = useGameStore((s) => s.myId);
  const resetGame = useGameStore((s) => s.resetGame);
  const restartGame = useGameStore((s) => s.restartGame);
  const [showOptions, setShowOptions] = useState(false);
  const [newSeed, setNewSeed] = useState("");
  if (!result) return null;

  const win = result === "win";
  const me = room?.players.find((p) => p.id === myId);
  const isHost = me?.isHost ?? false;

  const handleRestartSame = (): void => {
    if (!config) return;
    restartGame(true);
    setShowOptions(false);
  };

  const handleRestartNew = (): void => {
    restartGame(false, newSeed.trim() || undefined);
    setNewSeed("");
    setShowOptions(false);
  };

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-ink-950/70 backdrop-blur-sm">
      <div className="panel w-80 text-center">
        {win ? (
          <Trophy className="mx-auto h-12 w-12 text-emerald drop-shadow-[0_0_12px_var(--tw-shadow-color)]" />
        ) : (
          <Bomb className="mx-auto h-12 w-12 text-danger drop-shadow-[0_0_12px_var(--tw-shadow-color)]" />
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
        {config && (
          <p className="mt-2 font-mono text-[10px] text-zinc-500">
            种子: <span className="text-zinc-400">{config.seed}</span>
          </p>
        )}
        {isHost ? (
          !showOptions ? (
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                className="tac-btn-primary flex items-center justify-center gap-2"
                onClick={() => setShowOptions(true)}
              >
                <RotateCcw className="h-4 w-4" /> 重新开始
              </button>
              <button
                type="button"
                className="tac-btn flex items-center justify-center gap-2"
                onClick={resetGame}
              >
                返回等待室
              </button>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                className="tac-btn flex items-center justify-center gap-2"
                onClick={handleRestartSame}
              >
                <RefreshCw className="h-4 w-4" /> 同种子复盘
              </button>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 rounded border border-ink-600 bg-ink-800 px-2 py-1 font-mono text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber focus:outline-none"
                  placeholder="输入新种子（可选）"
                  value={newSeed}
                  onChange={(e) => setNewSeed(e.target.value)}
                />
                <button
                  type="button"
                  className="tac-btn-primary flex items-center gap-1"
                  onClick={handleRestartNew}
                >
                  <Shuffle className="h-4 w-4" /> 新种子
                </button>
              </div>
              <button
                type="button"
                className="mt-1 text-xs text-zinc-500 hover:text-zinc-300"
                onClick={() => setShowOptions(false)}
              >
                取消
              </button>
            </div>
          )
        ) : (
          <p className="mt-4 font-mono text-xs text-zinc-500">等待房主重新开始…</p>
        )}
      </div>
    </div>
  );
}
