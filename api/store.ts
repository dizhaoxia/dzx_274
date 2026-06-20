/**
 * 内存房间存储（第 1-2 周无需数据库）。
 * 持有所有房间的权威状态：玩家、配置、雷位、已翻开集合、标记状态。
 * 
 * v2.0 新增：
 * - globalVersion：全局版本号，每次状态变更递增
 * - stateHistory：增量状态历史，用于版本号回滚时的增量同步
 * - pausedAt / pausedElapsed：暂停状态管理
 * - frozen：游戏结束后冻结所有操作
 */
import type { CellState, Difficulty, GameConfig, IncrementalState, RevealedCell, RoomStatus } from "@shared/protocol";

export interface ServerPlayer {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
}

export interface StateHistoryEntry {
  version: number;
  delta: IncrementalState;
  timestamp: number;
}

export interface ServerRoom {
  code: string;
  hostId: string;
  players: Map<string, ServerPlayer>;
  status: RoomStatus;
  difficulty: Difficulty;
  config?: GameConfig;
  mines?: Set<number>;
  revealed: Set<number>;
  flags: Map<number, CellState>;
  gameStartTimestamp?: number;
  pausedAt?: number;
  pausedElapsed?: number;
  globalVersion: number;
  stateHistory: StateHistoryEntry[];
  frozen: boolean;
  explodedCell?: number;
}

/** 去除易混淆字符（O/0/I/1）的邀请码字符集 */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_HISTORY_LENGTH = 100;

export class RoomStore {
  private rooms = new Map<string, ServerRoom>();

  genCode(): string {
    for (let attempt = 0; attempt < 200; attempt++) {
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  get(code: string): ServerRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  set(room: ServerRoom): void {
    this.rooms.set(room.code, room);
  }

  delete(code: string): void {
    this.rooms.delete(code.toUpperCase());
  }

  all(): IterableIterator<ServerRoom> {
    return this.rooms.values();
  }

  incrementVersion(room: ServerRoom): void {
    room.globalVersion++;
  }

  appendHistory(
    room: ServerRoom,
    revealed: RevealedCell[],
    flags: Array<{ row: number; col: number; state: CellState }>,
    status?: RoomStatus,
    explodedCell?: { row: number; col: number } | null
  ): void {
    const fromVersion = room.globalVersion;
    this.incrementVersion(room);
    const delta: IncrementalState = {
      fromVersion,
      toVersion: room.globalVersion,
      revealed,
      flags,
      status,
      explodedCell,
    };
    room.stateHistory.push({
      version: room.globalVersion,
      delta,
      timestamp: Date.now(),
    });
    if (room.stateHistory.length > MAX_HISTORY_LENGTH) {
      room.stateHistory = room.stateHistory.slice(-MAX_HISTORY_LENGTH);
    }
  }

  getDeltaSince(room: ServerRoom, fromVersion: number): IncrementalState | null {
    if (fromVersion >= room.globalVersion) return null;
    
    const relevant = room.stateHistory.filter((h) => h.version > fromVersion);
    if (relevant.length === 0) return null;

    const combined: IncrementalState = {
      fromVersion,
      toVersion: room.globalVersion,
      revealed: [],
      flags: [],
    };

    const seenRevealed = new Set<string>();
    const seenFlags = new Set<string>();

    for (const entry of relevant) {
      for (const r of entry.delta.revealed) {
        const key = `${r.row}:${r.col}`;
        if (!seenRevealed.has(key)) {
          seenRevealed.add(key);
          combined.revealed.push(r);
        }
      }
      for (const f of entry.delta.flags) {
        const key = `${f.row}:${f.col}`;
        seenFlags.add(key);
        const existingIdx = combined.flags.findIndex((cf) => `${cf.row}:${cf.col}` === key);
        if (existingIdx >= 0) {
          combined.flags[existingIdx] = f;
        } else {
          combined.flags.push(f);
        }
      }
      if (entry.delta.status) {
        combined.status = entry.delta.status;
      }
      if (entry.delta.explodedCell !== undefined) {
        combined.explodedCell = entry.delta.explodedCell;
      }
    }

    return combined;
  }

  getAuthoritativeElapsed(room: ServerRoom, now: number): number {
    if (!room.gameStartTimestamp) return 0;
    if (room.status === "paused" && room.pausedAt) {
      return room.pausedElapsed ?? (room.pausedAt - room.gameStartTimestamp);
    }
    const totalElapsed = now - room.gameStartTimestamp;
    return Math.max(0, totalElapsed - (room.pausedAt ? now - room.pausedAt : 0));
  }
}

export const roomStore = new RoomStore();
