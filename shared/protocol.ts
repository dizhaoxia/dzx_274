/**
 * 共享协议层：前后端共用的算法版本常量、难度预设、数据类型与 Socket 消息定义。
 * 任何消息体均携带 version 字段，用于校验客户端算法版本与 ALGO_VERSION 是否一致。
 * 
 * v2.0 新增：
 * - globalVersion / stateVersion：乐观更新与版本号回滚机制
 * - IncrementalState：增量状态包（仅传输变化的格子）
 * - AtomicCellOp：原子操作指令，用于批量操作拆解
 * - game:pause / game:resume：服务端统一控制暂停
 * - game:over / game:victory：协同胜利/失败广播
 * - game:restart：支持同种子复盘或新种子
 * - 增强的时间同步：支持延迟补偿
 */

export const ALGO_VERSION = "2.0.0";

/** Socket 通道事件名：单一入站/出站通道，载荷为带 type 的判别联合体 */
export const C2S_EVENT = "c2s";
export const S2C_EVENT = "s2c";

export type Difficulty = "beginner" | "intermediate" | "expert";

export interface DifficultyPreset {
  rows: number;
  cols: number;
  mineCount: number;
}

export const DIFFICULTY_PRESETS: Record<Difficulty, DifficultyPreset> = {
  beginner: { rows: 9, cols: 9, mineCount: 10 },
  intermediate: { rows: 16, cols: 16, mineCount: 40 },
  expert: { rows: 16, cols: 30, mineCount: 99 },
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "初级 9×9 · 10 雷",
  intermediate: "中级 16×16 · 40 雷",
  expert: "高级 16×30 · 99 雷",
};

export type CellState = "hidden" | "revealed" | "flagged" | "question";

export interface RevealedCell {
  row: number;
  col: number;
  adjacent: number;
  isMine: boolean;
}

export interface GameConfig {
  seed: string;
  rows: number;
  cols: number;
  mineCount: number;
  mineHash: string;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
  online: boolean;
}

export type RoomStatus = "waiting" | "playing" | "paused" | "ended";

export interface RoomSnapshot {
  code: string;
  hostId: string;
  players: PlayerSnapshot[];
  status: RoomStatus;
  difficulty: Difficulty;
  config?: GameConfig;
  gameStartTimestamp?: number;
  pausedAt?: number;
  pausedElapsed?: number;
  globalVersion: number;
}

export type CellOpResult = "boom" | "win" | "clear";

/** 增量状态包：仅传输变化的格子，用于版本号回滚时的高效同步 */
export interface IncrementalState {
  fromVersion: number;
  toVersion: number;
  revealed: Array<{ row: number; col: number; adjacent: number; isMine: boolean }>;
  flags: Array<{ row: number; col: number; state: CellState }>;
  status?: RoomStatus;
  explodedCell?: { row: number; col: number } | null;
}

/** 原子操作指令：用于批量操作拆解后的序列化执行 */
export type AtomicCellOp =
  | { type: "reveal"; row: number; col: number }
  | { type: "flag"; row: number; col: number; state: CellState };

/** 原子操作结果 */
export interface AtomicOpResult {
  op: AtomicCellOp;
  success: boolean;
  state: CellState;
  cells: RevealedCell[];
  result?: CellOpResult;
}

/** 客户端 → 服务端消息 */
export type ClientMessage =
  | { type: "room:create"; version: string; playerName: string; difficulty: Difficulty }
  | { type: "room:join"; version: string; code: string; playerName: string }
  | { type: "room:leave"; version: string }
  | { type: "room:ready"; version: string; ready: boolean }
  | { type: "game:start"; version: string }
  | { type: "game:reset"; version: string }
  | { type: "game:pause"; version: string }
  | { type: "game:resume"; version: string }
  | { 
      type: "game:restart"; 
      version: string; 
      reuseSeed: boolean; 
      newSeed?: string; 
    }
  | { type: "cell:reveal"; version: string; opId: string; row: number; col: number; stateVersion: number }
  | { type: "cell:flag"; version: string; opId: string; row: number; col: number; stateVersion: number }
  | { type: "cell:chord"; version: string; opId: string; row: number; col: number; stateVersion: number }
  | { type: "time:sync"; version: string; clientTime: number; clientPerfTime: number }
  | { type: "state:pull"; version: string; fromVersion: number };

/** 服务端 → 客户端消息 */
export type ServerMessage =
  | { type: "room:state"; version: string; room: RoomSnapshot }
  | { type: "game:config"; version: string; config: GameConfig }
  | { type: "game:started"; version: string; gameStartTimestamp: number; globalVersion: number }
  | { 
      type: "game:paused"; 
      version: string; 
      pausedAt: number; 
      pausedElapsed: number;
      globalVersion: number; 
    }
  | { 
      type: "game:resumed"; 
      version: string; 
      resumedAt: number;
      globalVersion: number; 
    }
  | { 
      type: "game:over"; 
      version: string; 
      explodedCell: { row: number; col: number };
      playerId: string;
      playerName: string;
      cells: RevealedCell[];
      globalVersion: number;
    }
  | { 
      type: "game:victory"; 
      version: string; 
      globalVersion: number;
    }
  | {
      type: "cell:ack";
      version: string;
      opId: string;
      ok: boolean;
      rollback: boolean;
      row: number;
      col: number;
      state: CellState;
      cells: RevealedCell[];
      result?: CellOpResult;
      globalVersion: number;
      incrementalState?: IncrementalState;
    }
  | {
      type: "cell:broadcast";
      version: string;
      playerId: string;
      playerName: string;
      row: number;
      col: number;
      state: CellState;
      cells: RevealedCell[];
      result?: CellOpResult;
      globalVersion: number;
    }
  | {
      type: "state:delta";
      version: string;
      delta: IncrementalState;
    }
  | { 
      type: "time:sync"; 
      version: string; 
      serverTime: number; 
      serverPerfTime: number;
      clientTime: number;
      clientPerfTime: number;
      authoritativeElapsed: number;
    }
  | { 
      type: "time:authoritative";
      version: string;
      serverTime: number;
      authoritativeElapsed: number;
      isPaused: boolean;
    }
  | { type: "error"; version: string; code: string; message: string };

export function cellIndex(row: number, col: number, cols: number): number {
  return row * cols + col;
}

export function cellLockKey(roomCode: string, row: number, col: number): string {
  return `cell:${roomCode}:${row}:${col}`;
}
