/**
 * 确定性雷区生成与翻格计算。前后端共用，确保雷位与翻格结果完全一致。
 * - generateMineSet：基于 seed 用 Fisher-Yates 洗牌产出雷位集合。
 * - computeMineHash：对雷位排序后哈希，用于服务端下发 / 客户端校验。
 * - floodReveal：给定起点，计算应翻开的格子（含数字格边界）。
 */

import { DeterministicRandom } from "./deterministic";
import { cellIndex } from "./protocol";
import type { RevealedCell } from "./protocol";

export interface BoardDims {
  rows: number;
  cols: number;
  mineCount: number;
  seed: string;
}

/** 生成确定性雷位集合 */
export function generateMineSet(dims: BoardDims): Set<number> {
  const { rows, cols, mineCount, seed } = dims;
  const total = rows * cols;
  const count = Math.min(Math.max(mineCount, 0), total);
  const rng = new DeterministicRandom(seed);
  const indices = new Array<number>(total);
  for (let i = 0; i < total; i++) indices[i] = i;
  for (let i = total - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  const mines = new Set<number>();
  for (let i = 0; i < count; i++) mines.add(indices[i]);
  return mines;
}

/** 计算雷位哈希（djb2 → 8 位 hex） */
export function computeMineHash(mines: Iterable<number>): string {
  const sorted = Array.from(mines).sort((a, b) => a - b);
  const str = sorted.join(",");
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 由棋盘维度直接生成 mineHash（服务端下发前计算） */
export function buildMineHash(dims: BoardDims): string {
  return computeMineHash(generateMineSet(dims));
}

export function isMine(mines: Set<number>, row: number, col: number, cols: number): boolean {
  return mines.has(cellIndex(row, col, cols));
}

/** 计算某格周围 8 邻的雷数 */
export function adjacentMines(
  mines: Set<number>,
  row: number,
  col: number,
  rows: number,
  cols: number,
): number {
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      if (mines.has(cellIndex(r, c, cols))) count++;
    }
  }
  return count;
}

/**
 * 计算从 (startRow, startCol) 翻开后应展开的所有格子。
 * - 若起点为雷：仅返回该雷格。
 * - 若起点为数字格：仅返回该格。
 * - 若起点为空格(0 邻雷)：洪水填充展开连通的空格区域及数字边界。
 * 注意：本函数为纯函数，不关心是否已被翻开，由调用方去重。
 */
export function floodReveal(
  mines: Set<number>,
  rows: number,
  cols: number,
  startRow: number,
  startCol: number,
): RevealedCell[] {
  const out: RevealedCell[] = [];
  if (startRow < 0 || startRow >= rows || startCol < 0 || startCol >= cols) {
    return out;
  }
  if (isMine(mines, startRow, startCol, cols)) {
    out.push({ row: startRow, col: startCol, adjacent: 0, isMine: true });
    return out;
  }
  const visited = new Set<number>();
  const stack: Array<[number, number]> = [[startRow, startCol]];
  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    const idx = cellIndex(r, c, cols);
    if (visited.has(idx)) continue;
    visited.add(idx);
    const adj = adjacentMines(mines, r, c, rows, cols);
    out.push({ row: r, col: c, adjacent: adj, isMine: false });
    if (adj === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const nidx = cellIndex(nr, nc, cols);
          if (!visited.has(nidx) && !isMine(mines, nr, nc, cols)) {
            stack.push([nr, nc]);
          }
        }
      }
    }
  }
  return out;
}

/** 返回棋盘上所有雷格（用于爆炸后展示全雷） */
export function allMines(mines: Set<number>, cols: number): RevealedCell[] {
  const out: RevealedCell[] = [];
  mines.forEach((idx) => {
    out.push({ row: Math.floor(idx / cols), col: idx % cols, adjacent: 0, isMine: true });
  });
  return out;
}
