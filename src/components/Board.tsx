/** 雷区棋盘：读取 store 中的确定性雷位与状态，渲染格子网格。
 *  v2.0 新增：暂停状态显示、冻结状态锁定。
 */
import { adjacentMines } from "@shared/board";
import { cellIndex } from "@shared/protocol";
import { useGameStore } from "@/store/gameStore";
import { Cell } from "./Cell";
import { Pause } from "lucide-react";

export function Board() {
  const config = useGameStore((s) => s.config);
  const rows = useGameStore((s) => s.rows);
  const cols = useGameStore((s) => s.cols);
  const mines = useGameStore((s) => s.mines);
  const revealed = useGameStore((s) => s.revealed);
  const flags = useGameStore((s) => s.flags);
  const pendingCells = useGameStore((s) => s.pendingCells);
  const explodedCell = useGameStore((s) => s.explodedCell);
  const result = useGameStore((s) => s.result);
  const isPaused = useGameStore((s) => s.isPaused);
  const room = useGameStore((s) => s.room);

  if (!config) return null;

  const frozen = explodedCell !== null || result !== null;
  const disabled = frozen || isPaused;
  const size = cols <= 9 ? 34 : cols <= 16 ? 30 : 24;
  const gap = 2;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = cellIndex(r, c, cols);
      const isRev = revealed.has(idx);
      const flagState = flags.get(idx);
      const state = isRev ? "revealed" : flagState ?? "hidden";
      cells.push(
        <Cell
          key={idx}
          row={r}
          col={c}
          state={state}
          adjacent={isRev ? adjacentMines(mines, r, c, rows, cols) : 0}
          isMine={mines.has(idx)}
          exploded={explodedCell === idx}
          pending={pendingCells.has(idx)}
          disabled={disabled}
          frozen={frozen}
          size={size}
        />,
      );
    }
  }

  return (
    <div className="scrollbar-thin relative grid place-items-center overflow-auto p-2">
      {isPaused && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-950/60 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 text-amber">
            <Pause className="h-12 w-12 animate-pulse" />
            <p className="font-display text-xl tracking-[0.3em]">游戏暂停</p>
            <p className="font-mono text-xs text-zinc-400">
              {room?.players.find((p) => p.isHost)?.name} 已暂停游戏
            </p>
          </div>
        </div>
      )}
      <div
        className="grid transition-opacity duration-200"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${size}px)`,
          gap: `${gap}px`,
          opacity: isPaused ? 0.3 : 1,
        }}
      >
        {cells}
      </div>
    </div>
  );
}
