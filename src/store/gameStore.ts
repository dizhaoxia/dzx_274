/**
 * 全局游戏状态（Zustand）：
 * - 持有房间快照、确定性棋盘配置与本地雷位（由种子派生）。
 * - 翻格/标旗/双击采用本地乐观更新 + 服务端 ACK 固化；ACK 不一致则回滚快照。
 * - 维护 NTP 式服务端时间偏移，用于计时同步。
 */
import { create } from "zustand";
import { cellIndex } from "@shared/protocol";
import type {
  CellOpResult,
  CellState,
  GameConfig,
  RoomSnapshot,
  ServerMessage,
} from "@shared/protocol";
import {
  adjacentMines,
  allMines,
  computeMineHash,
  floodReveal,
  generateMineSet,
  isMine,
} from "@shared/board";
import { send } from "@/lib/socket";

export type LogKind =
  | "reveal"
  | "flag"
  | "chord"
  | "boom"
  | "win"
  | "system"
  | "join"
  | "leave"
  | "ready";

export interface LogEntry {
  id: number;
  ts: number;
  player: string;
  text: string;
  kind: LogKind;
}

interface PendingOp {
  opId: string;
  prevRevealed: Set<number>;
  prevFlags: Map<number, CellState>;
  touched: number[];
}

interface GameState {
  connected: boolean;
  myId: string | null;
  myName: string;
  room: RoomSnapshot | null;
  config: GameConfig | null;
  rows: number;
  cols: number;
  mines: Set<number>;
  revealed: Set<number>;
  flags: Map<number, CellState>;
  pendingOps: Map<string, PendingOp>;
  pendingCells: Set<number>;
  explodedCell: number | null;
  result: CellOpResult | null;
  gameStartTimestamp: number | null;
  serverOffset: number;
  lastSyncAt: number;
  logs: LogEntry[];
  error: string | null;
  hashVerified: boolean | null;

  setConnected: (v: boolean) => void;
  setMyId: (id: string) => void;
  applyMessage: (msg: ServerMessage) => void;
  createRoom: (name: string, difficulty: RoomSnapshot["difficulty"]) => void;
  joinRoom: (code: string, name: string) => void;
  leaveRoom: () => void;
  setReady: (ready: boolean) => void;
  startGame: () => void;
  resetGame: () => void;
  reveal: (row: number, col: number) => void;
  flag: (row: number, col: number) => void;
  chord: (row: number, col: number) => void;
  requestTimeSync: () => void;
  clearError: () => void;
  resetBoard: () => void;
}

let logSeq = 0;

function genOpId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function recomputePending(ops: Map<string, PendingOp>): Set<number> {
  const s = new Set<number>();
  ops.forEach((op) => op.touched.forEach((i) => s.add(i)));
  return s;
}

function describeOp(state: CellState, cells: { length: number }, result?: CellOpResult): { text: string; kind: LogKind } {
  if (result === "boom") return { text: "踩雷 💥", kind: "boom" };
  if (result === "win") return { text: "排雷成功 🎉", kind: "win" };
  if (state === "flagged") return { text: "插旗", kind: "flag" };
  if (state === "question") return { text: "标记问号", kind: "flag" };
  if (state === "hidden") return { text: "取消标记", kind: "flag" };
  return { text: `翻开 ${cells.length} 格`, kind: "reveal" };
}

export const useGameStore = create<GameState>()((set, get) => {
  function addLog(player: string, text: string, kind: LogKind): void {
    set((s) => ({
      logs: [...s.logs.slice(-49), { id: ++logSeq, ts: Date.now(), player, text, kind }],
    }));
  }

  function applyRevealedCells(cells: { row: number; col: number }[], extra?: Partial<GameState>): void {
    const s = get();
    const revealed = new Set(s.revealed);
    cells.forEach((c) => revealed.add(cellIndex(c.row, c.col, s.cols)));
    set({ revealed, ...extra });
  }

  return {
    connected: false,
    myId: null,
    myName: "",
    room: null,
    config: null,
    rows: 0,
    cols: 0,
    mines: new Set<number>(),
    revealed: new Set<number>(),
    flags: new Map<number, CellState>(),
    pendingOps: new Map<string, PendingOp>(),
    pendingCells: new Set<number>(),
    explodedCell: null,
    result: null,
    gameStartTimestamp: null,
    serverOffset: 0,
    lastSyncAt: 0,
    logs: [],
    error: null,
    hashVerified: null,

    setConnected: (v) => set({ connected: v }),
    setMyId: (id) => set({ myId: id }),

    applyMessage: (msg) => {
      const s = get();
      switch (msg.type) {
        case "room:state": {
          const room = msg.room;
          const boardCleared = room.status === "waiting" && !room.config;
          set({
            room,
            gameStartTimestamp: room.gameStartTimestamp ?? s.gameStartTimestamp,
            ...(boardCleared
              ? {
                  config: null,
                  rows: 0,
                  cols: 0,
                  mines: new Set(),
                  revealed: new Set(),
                  flags: new Map(),
                  pendingOps: new Map(),
                  pendingCells: new Set(),
                  explodedCell: null,
                  result: null,
                  hashVerified: null,
                }
              : {}),
          });
          break;
        }
        case "game:config": {
          const cfg = msg.config;
          const mines = generateMineSet({
            rows: cfg.rows,
            cols: cfg.cols,
            mineCount: cfg.mineCount,
            seed: cfg.seed,
          });
          const localHash = computeMineHash(mines);
          const ok = localHash === cfg.mineHash;
          set({
            config: cfg,
            rows: cfg.rows,
            cols: cfg.cols,
            mines,
            revealed: new Set(),
            flags: new Map(),
            pendingOps: new Map(),
            pendingCells: new Set(),
            explodedCell: null,
            result: null,
            gameStartTimestamp: null,
            hashVerified: ok,
            error: ok ? null : `雷区哈希校验失败（本地 ${localHash} ≠ 服务端 ${cfg.mineHash}），算法版本不一致。`,
          });
          addLog("系统", ok ? "棋盘已同步，哈希校验通过" : "哈希校验失败", "system");
          break;
        }
        case "game:started": {
          set({ gameStartTimestamp: msg.gameStartTimestamp });
          addLog("系统", "计时开始", "system");
          break;
        }
        case "cell:ack": {
          const op = s.pendingOps.get(msg.opId);
          if (!op) break;
          const pendingOps = new Map(s.pendingOps);
          pendingOps.delete(msg.opId);
          if (!msg.ok) {
            set({
              revealed: op.prevRevealed,
              flags: op.prevFlags,
              pendingOps,
              pendingCells: recomputePending(pendingOps),
            });
            break;
          }
          const revealed = new Set(s.revealed);
          let flags = s.flags;
          let explodedCell = s.explodedCell;
          let result = s.result;
          msg.cells.forEach((c) => revealed.add(cellIndex(c.row, c.col, s.cols)));
          if (msg.state === "flagged" || msg.state === "question") {
            flags = new Map(s.flags);
            flags.set(cellIndex(msg.row, msg.col, s.cols), msg.state);
          } else if (msg.state === "hidden") {
            flags = new Map(s.flags);
            flags.delete(cellIndex(msg.row, msg.col, s.cols));
          }
          if (msg.result === "boom") {
            explodedCell = cellIndex(msg.row, msg.col, s.cols);
            result = "boom";
          } else if (msg.result === "win") {
            result = "win";
          }
          set({
            revealed,
            flags,
            explodedCell,
            result,
            pendingOps,
            pendingCells: recomputePending(pendingOps),
          });
          const desc = describeOp(msg.state, msg.cells, msg.result);
          addLog(s.myName || "你", desc.text, desc.kind);
          break;
        }
        case "cell:broadcast": {
          const revealed = new Set(s.revealed);
          let flags = s.flags;
          let explodedCell = s.explodedCell;
          let result = s.result;
          msg.cells.forEach((c) => revealed.add(cellIndex(c.row, c.col, s.cols)));
          if (msg.state === "flagged" || msg.state === "question") {
            flags = new Map(s.flags);
            flags.set(cellIndex(msg.row, msg.col, s.cols), msg.state);
          } else if (msg.state === "hidden") {
            flags = new Map(s.flags);
            flags.delete(cellIndex(msg.row, msg.col, s.cols));
          }
          if (msg.result === "boom") {
            explodedCell = cellIndex(msg.row, msg.col, s.cols);
            result = "boom";
          } else if (msg.result === "win") {
            result = "win";
          }
          set({ revealed, flags, explodedCell, result });
          const desc = describeOp(msg.state, msg.cells, msg.result);
          addLog(msg.playerName, desc.text, desc.kind);
          break;
        }
        case "time:sync": {
          set({ serverOffset: msg.serverTime - Date.now(), lastSyncAt: Date.now() });
          break;
        }
        case "error": {
          set({ error: msg.message });
          addLog("系统", msg.message, "system");
          break;
        }
        default:
          break;
      }
    },

    createRoom: (name, difficulty) => {
      set({ myName: name, error: null });
      try {
        localStorage.setItem("coop_ms_name", name);
      } catch {
        /* ignore */
      }
      send({ type: "room:create", playerName: name, difficulty });
    },
    joinRoom: (code, name) => {
      set({ myName: name, error: null });
      try {
        localStorage.setItem("coop_ms_name", name);
      } catch {
        /* ignore */
      }
      send({ type: "room:join", code, playerName: name });
    },
    leaveRoom: () => {
      send({ type: "room:leave" });
      set({
        room: null,
        config: null,
        rows: 0,
        cols: 0,
        mines: new Set(),
        revealed: new Set(),
        flags: new Map(),
        pendingOps: new Map(),
        pendingCells: new Set(),
        explodedCell: null,
        result: null,
        gameStartTimestamp: null,
        hashVerified: null,
      });
    },
    setReady: (ready) => send({ type: "room:ready", ready }),
    startGame: () => send({ type: "game:start" }),
    resetGame: () => send({ type: "game:reset" }),
    requestTimeSync: () => send({ type: "time:sync", clientTime: Date.now() }),

    reveal: (row, col) => {
      const s = get();
      if (!s.config || s.explodedCell !== null || s.result !== null) return;
      const idx = cellIndex(row, col, s.cols);
      if (s.revealed.has(idx) || s.flags.get(idx) === "flagged") return;
      const opId = genOpId();
      const prevRevealed = new Set(s.revealed);
      const prevFlags = new Map(s.flags);
      const touched: number[] = [];
      const revealed = new Set(s.revealed);
      let explodedCell = s.explodedCell;
      if (isMine(s.mines, row, col, s.cols)) {
        allMines(s.mines, s.cols).forEach((c) => {
          const ci = cellIndex(c.row, c.col, s.cols);
          revealed.add(ci);
          touched.push(ci);
        });
        touched.push(idx);
        explodedCell = idx;
      } else {
        floodReveal(s.mines, s.rows, s.cols, row, col).forEach((c) => {
          const ci = cellIndex(c.row, c.col, s.cols);
          if (!revealed.has(ci)) {
            revealed.add(ci);
            touched.push(ci);
          }
        });
      }
      const pendingOps = new Map(s.pendingOps);
      pendingOps.set(opId, { opId, prevRevealed, prevFlags, touched });
      set({
        revealed,
        explodedCell,
        pendingOps,
        pendingCells: recomputePending(pendingOps),
      });
      send({ type: "cell:reveal", opId, row, col });
    },

    flag: (row, col) => {
      const s = get();
      if (!s.config || s.explodedCell !== null || s.result !== null) return;
      const idx = cellIndex(row, col, s.cols);
      if (s.revealed.has(idx)) return;
      const cur = s.flags.get(idx) ?? "hidden";
      const next: CellState = cur === "hidden" ? "flagged" : cur === "flagged" ? "question" : "hidden";
      const opId = genOpId();
      const prevFlags = new Map(s.flags);
      const flags = new Map(s.flags);
      if (next === "hidden") flags.delete(idx);
      else flags.set(idx, next);
      const pendingOps = new Map(s.pendingOps);
      pendingOps.set(opId, { opId, prevRevealed: new Set(s.revealed), prevFlags, touched: [idx] });
      set({ flags, pendingOps, pendingCells: recomputePending(pendingOps) });
      send({ type: "cell:flag", opId, row, col });
    },

    chord: (row, col) => {
      const s = get();
      if (!s.config || s.explodedCell !== null || s.result !== null) return;
      const idx = cellIndex(row, col, s.cols);
      if (!s.revealed.has(idx)) return;
      const num = adjacentMines(s.mines, row, col, s.rows, s.cols);
      if (num === 0) return;
      let flagCount = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r >= s.rows || c < 0 || c >= s.cols) continue;
          if (s.flags.get(cellIndex(r, c, s.cols)) === "flagged") flagCount++;
        }
      }
      if (flagCount !== num) return;
      const opId = genOpId();
      const prevRevealed = new Set(s.revealed);
      const prevFlags = new Map(s.flags);
      const touched: number[] = [];
      const revealed = new Set(s.revealed);
      let explodedCell = s.explodedCell;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r >= s.rows || c < 0 || c >= s.cols) continue;
          const ni = cellIndex(r, c, s.cols);
          if (s.flags.get(ni) === "flagged" || s.revealed.has(ni)) continue;
          if (isMine(s.mines, r, c, s.cols)) {
            allMines(s.mines, s.cols).forEach((mc) => {
              const ci = cellIndex(mc.row, mc.col, s.cols);
              revealed.add(ci);
              touched.push(ci);
            });
            touched.push(ni);
            explodedCell = ni;
            break;
          }
          floodReveal(s.mines, s.rows, s.cols, r, c).forEach((cell) => {
            const ci = cellIndex(cell.row, cell.col, s.cols);
            if (!revealed.has(ci)) {
              revealed.add(ci);
              touched.push(ci);
            }
          });
        }
      }
      const pendingOps = new Map(s.pendingOps);
      pendingOps.set(opId, { opId, prevRevealed, prevFlags, touched });
      set({ revealed, explodedCell, pendingOps, pendingCells: recomputePending(pendingOps) });
      send({ type: "cell:chord", opId, row, col });
    },

    clearError: () => set({ error: null }),
    resetBoard: () =>
      set({
        config: null,
        rows: 0,
        cols: 0,
        mines: new Set(),
        revealed: new Set(),
        flags: new Map(),
        pendingOps: new Map(),
        pendingCells: new Set(),
        explodedCell: null,
        result: null,
        gameStartTimestamp: null,
        hashVerified: null,
      }),
  };
});
