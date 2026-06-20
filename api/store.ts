/**
 * 内存房间存储（第 1-2 周无需数据库）。
 * 持有所有房间的权威状态：玩家、配置、雷位、已翻开集合、标记状态。
 */
import type { CellState, Difficulty, GameConfig, RoomStatus } from "@shared/protocol";

export interface ServerPlayer {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
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
}

/** 去除易混淆字符（O/0/I/1）的邀请码字符集 */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
}

export const roomStore = new RoomStore();
