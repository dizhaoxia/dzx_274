/**
 * 共享协议层：前后端共用的算法版本常量、难度预设、数据类型与 Socket 消息定义。
 * 任何消息体均携带 version 字段，用于校验客户端算法版本与 ALGO_VERSION 是否一致。
 */

export const ALGO_VERSION = "1.0.0";

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

export type RoomStatus = "waiting" | "playing" | "ended";

export interface RoomSnapshot {
  code: string;
  hostId: string;
  players: PlayerSnapshot[];
  status: RoomStatus;
  difficulty: Difficulty;
  config?: GameConfig;
  gameStartTimestamp?: number;
}

export type CellOpResult = "boom" | "win" | "clear";

/** 客户端 → 服务端消息 */
export type ClientMessage =
  | { type: "room:create"; version: string; playerName: string; difficulty: Difficulty }
  | { type: "room:join"; version: string; code: string; playerName: string }
  | { type: "room:leave"; version: string }
  | { type: "room:ready"; version: string; ready: boolean }
  | { type: "game:start"; version: string }
  | { type: "game:reset"; version: string }
  | { type: "cell:reveal"; version: string; opId: string; row: number; col: number }
  | { type: "cell:flag"; version: string; opId: string; row: number; col: number }
  | { type: "cell:chord"; version: string; opId: string; row: number; col: number }
  | { type: "time:sync"; version: string; clientTime: number };

/** 服务端 → 客户端消息 */
export type ServerMessage =
  | { type: "room:state"; version: string; room: RoomSnapshot }
  | { type: "game:config"; version: string; config: GameConfig }
  | { type: "game:started"; version: string; gameStartTimestamp: number }
  | {
      type: "cell:ack";
      version: string;
      opId: string;
      ok: boolean;
      row: number;
      col: number;
      state: CellState;
      cells: RevealedCell[];
      result?: CellOpResult;
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
    }
  | { type: "time:sync"; version: string; serverTime: number }
  | { type: "error"; version: string; code: string; message: string };

export function cellIndex(row: number, col: number, cols: number): number {
  return row * cols + col;
}
