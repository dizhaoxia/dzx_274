/**
 * 全局游戏状态（Zustand）：
 * - 持有房间快照、确定性棋盘配置与本地雷位（由种子派生）。
 * - 翻格/标旗/双击采用本地乐观更新 + 服务端 ACK 固化；ACK 不一致则回滚快照。
 * - 维护 NTP 式服务端时间偏移，用于计时同步。
 * 
 * v2.0 新增：
 * - stateVersion / globalVersion 版本号管理
 * - 增量状态包应用
 * - 延迟补偿（performance.now + Server-Sent Timestamp）
 * - 平滑计时插值
 * - 乐观更新回滚强化（rollback 标志）
 * - 暂停状态管理
 * - 同种子复盘 / 新种子重开
 */
import { create } from "zustand";
import { cellIndex } from "@shared/protocol";
import type {
  CellOpResult,
  CellState,
  GameConfig,
  IncrementalState,
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
  | "ready"
  | "pause"
  | "resume";

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
  prevVersion: number;
  touched: number[];
}

interface TimeSyncState {
  serverOffset: number;
  lastSyncAt: number;
  oneWayDelay: number;
  authoritativeElapsed: number;
  lastAuthoritativeAt: number;
  smoothedElapsed: number;
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
  isPaused: boolean;
  pausedAt: number | null;
  pausedElapsed: number | null;
  stateVersion: number;
  globalVersion: number;
  timeSync: TimeSyncState;
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
  pauseGame: () => void;
  resumeGame: () => void;
  restartGame: (reuseSeed: boolean, newSeed?: string) => void;
  resetGame: () => void;
  reveal: (row: number, col: number) => void;
  flag: (row: number, col: number) => void;
  chord: (row: number, col: number) => void;
  requestTimeSync: () => void;
  pullState: (fromVersion: number) => void;
  clearError: () => void;
  resetBoard: () => void;
  getSmoothedElapsed: (now: number) => number;
  rollbackAllPending: () => void;
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

function applyIncrementalState(
  state: GameState,
  delta: IncrementalState
): Partial<GameState> {
  const revealed = new Set(state.revealed);
  const flags = new Map(state.flags);
  let explodedCell = state.explodedCell;
  let result = state.result;

  for (const c of delta.revealed) {
    revealed.add(cellIndex(c.row, c.col, state.cols));
  }
  for (const f of delta.flags) {
    const idx = cellIndex(f.row, f.col, state.cols);
    if (f.state === "hidden") {
      flags.delete(idx);
    } else {
      flags.set(idx, f.state);
    }
  }
  if (delta.explodedCell) {
    explodedCell = cellIndex(delta.explodedCell.row, delta.explodedCell.col, state.cols);
    result = "boom";
  }
  if (delta.status === "ended" && !result) {
    result = "win";
  }

  return {
    revealed,
    flags,
    explodedCell,
    result,
    globalVersion: delta.toVersion,
    stateVersion: delta.toVersion,
  };
}

function rollbackPendingOp(
  state: GameState,
  op: PendingOp
): Partial<GameState> {
  const pendingOps = new Map(state.pendingOps);
  pendingOps.delete(op.opId);
  return {
    revealed: op.prevRevealed,
    flags: op.prevFlags,
    pendingOps,
    pendingCells: recomputePending(pendingOps),
    stateVersion: op.prevVersion,
  };
}

const INITIAL_TIME_SYNC: TimeSyncState = {
  serverOffset: 0,
  lastSyncAt: 0,
  oneWayDelay: 0,
  authoritativeElapsed: 0,
  lastAuthoritativeAt: 0,
  smoothedElapsed: 0,
};

export const useGameStore = create<GameState>()((set, get) => {
  function addLog(player: string, text: string, kind: LogKind): void {
    set((s) => ({
      logs: [...s.logs.slice(-49), { id: ++logSeq, ts: Date.now(), player, text, kind }],
    }));
  }

  function rollbackAllPending(): void {
    const s = get();
    if (s.pendingOps.size === 0) return;
    let latestState = s;
    for (const op of s.pendingOps.values()) {
      const rolled = rollbackPendingOp(latestState, op);
      latestState = { ...latestState, ...rolled };
    }
    set(latestState);
    addLog("系统", "状态已同步，回滚本地乐观操作", "system");
  }

  function getSmoothedElapsed(now: number): number {
    const s = get();
    if (!s.gameStartTimestamp || s.isPaused) {
      return s.timeSync.smoothedElapsed;
    }
    const timeSinceLastAuth = now - s.timeSync.lastAuthoritativeAt;
    const target = s.timeSync.authoritativeElapsed + timeSinceLastAuth;
    const alpha = 0.1;
    const smoothed = s.timeSync.smoothedElapsed + alpha * (target - s.timeSync.smoothedElapsed);
    return Math.max(0, smoothed);
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
    isPaused: false,
    pausedAt: null,
    pausedElapsed: null,
    stateVersion: 0,
    globalVersion: 0,
    timeSync: { ...INITIAL_TIME_SYNC },
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
            isPaused: room.status === "paused",
            pausedAt: room.pausedAt ?? null,
            pausedElapsed: room.pausedElapsed ?? null,
            globalVersion: room.globalVersion,
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
                  stateVersion: 0,
                  globalVersion: 0,
                  isPaused: false,
                  pausedAt: null,
                  pausedElapsed: null,
                  timeSync: { ...INITIAL_TIME_SYNC },
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
            stateVersion: 0,
            globalVersion: 0,
            isPaused: false,
            pausedAt: null,
            pausedElapsed: null,
            timeSync: { ...INITIAL_TIME_SYNC },
            error: ok ? null : `雷区哈希校验失败（本地 ${localHash} ≠ 服务端 ${cfg.mineHash}），算法版本不一致。`,
          });
          addLog("系统", ok ? "棋盘已同步，哈希校验通过" : "哈希校验失败", "system");
          break;
        }
        case "game:started": {
          set({ 
            gameStartTimestamp: msg.gameStartTimestamp,
            globalVersion: msg.globalVersion,
            stateVersion: msg.globalVersion,
            isPaused: false,
            pausedAt: null,
            pausedElapsed: null,
            timeSync: {
              ...s.timeSync,
              authoritativeElapsed: 0,
              lastAuthoritativeAt: Date.now(),
              smoothedElapsed: 0,
            },
          });
          addLog("系统", "计时开始", "system");
          break;
        }
        case "game:paused": {
          set({
            isPaused: true,
            pausedAt: msg.pausedAt,
            pausedElapsed: msg.pausedElapsed,
            globalVersion: msg.globalVersion,
            stateVersion: msg.globalVersion,
            timeSync: {
              ...s.timeSync,
              authoritativeElapsed: msg.pausedElapsed,
              smoothedElapsed: msg.pausedElapsed,
            },
          });
          addLog("系统", "游戏已暂停", "pause");
          break;
        }
        case "game:resumed": {
          set({
            isPaused: false,
            pausedAt: null,
            pausedElapsed: null,
            globalVersion: msg.globalVersion,
            stateVersion: msg.globalVersion,
            timeSync: {
              ...s.timeSync,
              lastAuthoritativeAt: msg.resumedAt,
            },
          });
          addLog("系统", "游戏继续", "resume");
          break;
        }
        case "game:over": {
          const revealed = new Set(s.revealed);
          msg.cells.forEach((c) => revealed.add(cellIndex(c.row, c.col, s.cols)));
          set({
            revealed,
            explodedCell: cellIndex(msg.explodedCell.row, msg.explodedCell.col, s.cols),
            result: "boom",
            globalVersion: msg.globalVersion,
            stateVersion: msg.globalVersion,
            pendingOps: new Map(),
            pendingCells: new Set(),
          });
          addLog(msg.playerName, "踩雷 💥", "boom");
          addLog("系统", "游戏结束", "system");
          break;
        }
        case "game:victory": {
          set({
            result: "win",
            globalVersion: msg.globalVersion,
            stateVersion: msg.globalVersion,
            pendingOps: new Map(),
            pendingCells: new Set(),
          });
          addLog("系统", "排雷成功 🎉", "win");
          break;
        }
        case "cell:ack": {
          const op = s.pendingOps.get(msg.opId);
          if (!op) break;
          
          if (msg.rollback || !msg.ok) {
            const rollbackResult = rollbackPendingOp(s, op);
            let extra: Partial<GameState> = {};
            if (msg.incrementalState) {
              const applied = applyIncrementalState({ ...s, ...rollbackResult }, msg.incrementalState);
              extra = applied;
            }
            set({
              ...rollbackResult,
              ...extra,
              globalVersion: msg.globalVersion,
            });
            if (msg.rollback) {
              addLog("系统", "锁冲突，回滚本地操作并同步最新状态", "system");
            }
            break;
          }

          const pendingOps = new Map(s.pendingOps);
          pendingOps.delete(msg.opId);
          
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
            globalVersion: msg.globalVersion,
            stateVersion: msg.globalVersion,
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
          set({ 
            revealed, 
            flags, 
            explodedCell, 
            result,
            globalVersion: msg.globalVersion,
            stateVersion: msg.globalVersion,
          });
          const desc = describeOp(msg.state, msg.cells, msg.result);
          addLog(msg.playerName, desc.text, desc.kind);
          break;
        }
        case "state:delta": {
          const applied = applyIncrementalState(s, msg.delta);
          set(applied);
          addLog("系统", `同步增量状态 v${msg.delta.fromVersion} → v${msg.delta.toVersion}`, "system");
          break;
        }
        case "time:sync": {
          const clientReceivePerf = performance.now();
          const rtt = clientReceivePerf - msg.clientPerfTime;
          const oneWayDelay = rtt / 2;
          const serverTime = msg.serverTime + oneWayDelay;
          const serverOffset = serverTime - Date.now();
          set({ 
            timeSync: {
              ...s.timeSync,
              serverOffset,
              lastSyncAt: Date.now(),
              oneWayDelay,
              authoritativeElapsed: msg.authoritativeElapsed,
              lastAuthoritativeAt: Date.now(),
              smoothedElapsed: msg.authoritativeElapsed,
            },
          });
          break;
        }
        case "time:authoritative": {
          set({
            timeSync: {
              ...s.timeSync,
              authoritativeElapsed: msg.authoritativeElapsed,
              lastAuthoritativeAt: Date.now(),
              smoothedElapsed: msg.isPaused ? msg.authoritativeElapsed : s.timeSync.smoothedElapsed,
            },
            isPaused: msg.isPaused,
          });
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
        stateVersion: 0,
        globalVersion: 0,
        isPaused: false,
        pausedAt: null,
        pausedElapsed: null,
        timeSync: { ...INITIAL_TIME_SYNC },
      });
    },
    setReady: (ready) => send({ type: "room:ready", ready }),
    startGame: () => send({ type: "game:start" }),
    pauseGame: () => send({ type: "game:pause" }),
    resumeGame: () => send({ type: "game:resume" }),
    restartGame: (reuseSeed, newSeed) => send({ type: "game:restart", reuseSeed, newSeed }),
    resetGame: () => send({ type: "game:reset" }),
    requestTimeSync: () => send({ type: "time:sync", clientTime: Date.now(), clientPerfTime: performance.now() }),
    pullState: (fromVersion) => send({ type: "state:pull", fromVersion }),

    reveal: (row, col) => {
      const s = get();
      if (!s.config || s.explodedCell !== null || s.result !== null || s.isPaused) return;
      const idx = cellIndex(row, col, s.cols);
      if (s.revealed.has(idx) || s.flags.get(idx) === "flagged") return;
      const opId = genOpId();
      const prevRevealed = new Set(s.revealed);
      const prevFlags = new Map(s.flags);
      const prevVersion = s.stateVersion;
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
      pendingOps.set(opId, { opId, prevRevealed, prevFlags, prevVersion, touched });
      set({
        revealed,
        explodedCell,
        pendingOps,
        pendingCells: recomputePending(pendingOps),
        stateVersion: s.stateVersion + 1,
      });
      send({ type: "cell:reveal", opId, row, col, stateVersion: s.stateVersion });
    },

    flag: (row, col) => {
      const s = get();
      if (!s.config || s.explodedCell !== null || s.result !== null || s.isPaused) return;
      const idx = cellIndex(row, col, s.cols);
      if (s.revealed.has(idx)) return;
      const cur = s.flags.get(idx) ?? "hidden";
      const next: CellState = cur === "hidden" ? "flagged" : cur === "flagged" ? "question" : "hidden";
      const opId = genOpId();
      const prevFlags = new Map(s.flags);
      const prevVersion = s.stateVersion;
      const flags = new Map(s.flags);
      if (next === "hidden") flags.delete(idx);
      else flags.set(idx, next);
      const pendingOps = new Map(s.pendingOps);
      pendingOps.set(opId, { 
        opId, 
        prevRevealed: new Set(s.revealed), 
        prevFlags, 
        prevVersion,
        touched: [idx] 
      });
      set({ 
        flags, 
        pendingOps, 
        pendingCells: recomputePending(pendingOps),
        stateVersion: s.stateVersion + 1,
      });
      send({ type: "cell:flag", opId, row, col, stateVersion: s.stateVersion });
    },

    chord: (row, col) => {
      const s = get();
      if (!s.config || s.explodedCell !== null || s.result !== null || s.isPaused) return;
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
      const prevVersion = s.stateVersion;
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
      pendingOps.set(opId, { opId, prevRevealed, prevFlags, prevVersion, touched });
      set({ 
        revealed, 
        explodedCell, 
        pendingOps, 
        pendingCells: recomputePending(pendingOps),
        stateVersion: s.stateVersion + 1,
      });
      send({ type: "cell:chord", opId, row, col, stateVersion: s.stateVersion });
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
        stateVersion: 0,
        globalVersion: 0,
        isPaused: false,
        pausedAt: null,
        pausedElapsed: null,
        timeSync: { ...INITIAL_TIME_SYNC },
      }),

    getSmoothedElapsed,
    rollbackAllPending,
  };
});
