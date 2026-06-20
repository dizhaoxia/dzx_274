/** 雷区棋盘：读取 store 中的确定性雷位与状态，渲染格子网格。 */
import { adjacentMines } from "@shared/board";
import { cellIndex } from "@shared/protocol";
import { useGameStore } from "@/store/gameStore";
import { Cell } from "./Cell";

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

  if (!config) return null;

  const disabled = explodedCell !== null || result !== null;
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
          size={size}
        />,
      );
    }
  }

  return (
    <div className="scrollbar-thin grid place-items-center overflow-auto p-2">
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${cols}, ${size}px)`, gap: `${gap}px` }}
      >
        {cells}
      </div>
    </div>
  );
}
