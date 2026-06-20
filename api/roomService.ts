/**
 * 房间与游戏的权威逻辑层。
 * 所有翻格/标旗/双击结果均由本模块基于 shared 算法计算，服务端为唯一权威。
 * 本模块不直接接触 Socket.IO，只返回结构化结果，由 realtime 层负责广播。
 */
import { randomBytes } from "crypto";
import {
  DIFFICULTY_PRESETS,
  cellIndex,
} from "@shared/protocol";
import type {
  CellOpResult,
  CellState,
  GameConfig,
  RevealedCell,
  RoomSnapshot,
} from "@shared/protocol";
import {
  adjacentMines,
  allMines,
  buildMineHash,
  floodReveal,
  generateMineSet,
  isMine,
} from "@shared/board";
import type { ServerPlayer, ServerRoom } from "./store";
import { roomStore } from "./store";

export class ServiceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface CellOpOutcome {
  state: CellState;
  cells: RevealedCell[];
  result?: CellOpResult;
  started?: boolean;
}

export function snapshot(room: ServerRoom): RoomSnapshot {
  return {
    code: room.code,
    hostId: room.hostId,
    players: Array.from(room.players.values()).map((p: ServerPlayer) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      isHost: p.isHost,
      online: true,
    })),
    status: room.status,
    difficulty: room.difficulty,
    config: room.config,
    gameStartTimestamp: room.gameStartTimestamp,
  };
}

export function createRoom(
  hostId: string,
  name: string,
  difficulty: ServerRoom["difficulty"],
): ServerRoom {
  const code = roomStore.genCode();
  const room: ServerRoom = {
    code,
    hostId,
    players: new Map(),
    status: "waiting",
    difficulty,
    revealed: new Set(),
    flags: new Map(),
  };
  room.players.set(hostId, { id: hostId, name, ready: false, isHost: true });
  roomStore.set(room);
  return room;
}

export function joinRoom(
  playerId: string,
  name: string,
  code: string,
): ServerRoom {
  const room = roomStore.get(code);
  if (!room) throw new ServiceError("ROOM_NOT_FOUND", "房间不存在或邀请码错误");
  if (room.players.size >= 8) throw new ServiceError("ROOM_FULL", "房间已满（最多 8 人）");
  room.players.set(playerId, { id: playerId, name, ready: false, isHost: false });
  return room;
}

export interface LeaveResult {
  room?: ServerRoom;
  deleted: boolean;
  code?: string;
}

export function leaveRoom(playerId: string): LeaveResult {
  for (const room of roomStore.all()) {
    if (room.players.has(playerId)) {
      room.players.delete(playerId);
      if (room.players.size === 0) {
        roomStore.delete(room.code);
        return { deleted: true, code: room.code };
      }
      if (room.hostId === playerId) {
        const next = room.players.values().next().value;
        if (next) {
          next.isHost = true;
          room.hostId = next.id;
        }
      }
      return { room, deleted: false };
    }
  }
  return { deleted: false };
}

export function setReady(room: ServerRoom, playerId: string, ready: boolean): void {
  const p = room.players.get(playerId);
  if (!p) throw new ServiceError("NOT_IN_ROOM", "你不在房间内");
  p.ready = ready;
}

export function startGame(room: ServerRoom, playerId: string): GameConfig {
  if (room.hostId !== playerId) throw new ServiceError("NOT_HOST", "仅房主可开始游戏");
  for (const p of room.players.values()) {
    if (!p.isHost && !p.ready) throw new ServiceError("NOT_ALL_READY", "尚有玩家未准备");
  }
  const preset = DIFFICULTY_PRESETS[room.difficulty];
  const seed = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const config: GameConfig = {
    seed,
    rows: preset.rows,
    cols: preset.cols,
    mineCount: preset.mineCount,
    mineHash: buildMineHash({ ...preset, seed }),
  };
  room.config = config;
  room.mines = generateMineSet({ ...preset, seed });
  room.revealed = new Set();
  room.flags = new Map();
  room.status = "playing";
  room.gameStartTimestamp = undefined;
  return config;
}

export function resetGame(room: ServerRoom, playerId: string): void {
  if (room.hostId !== playerId) throw new ServiceError("NOT_HOST", "仅房主可重置棋盘");
  room.config = undefined;
  room.mines = undefined;
  room.revealed = new Set();
  room.flags = new Map();
  room.status = "waiting";
  room.gameStartTimestamp = undefined;
  for (const p of room.players.values()) p.ready = false;
}

function ensurePlaying(room: ServerRoom): { rows: number; cols: number } {
  if (room.status !== "playing" || !room.mines || !room.config) {
    throw new ServiceError("NOT_PLAYING", "游戏未在进行中");
  }
  return { rows: room.config.rows, cols: room.config.cols };
}

function checkWin(room: ServerRoom): boolean {
  if (!room.config || !room.mines) return false;
  const total = room.config.rows * room.config.cols;
  return room.revealed.size === total - room.mines.size;
}

export function revealCell(room: ServerRoom, row: number, col: number): CellOpOutcome {
  const { rows, cols } = ensurePlaying(room);
  const mines = room.mines!;
  const idx = cellIndex(row, col, cols);

  if (room.revealed.has(idx)) return { state: "revealed", cells: [], result: "clear" };
  if (room.flags.get(idx) === "flagged") return { state: "flagged", cells: [], result: "clear" };

  const started = room.gameStartTimestamp === undefined;
  if (started) room.gameStartTimestamp = Date.now();

  if (isMine(mines, row, col, cols)) {
    const cells = allMines(mines, cols);
    cells.forEach((c) => room.revealed.add(cellIndex(c.row, c.col, cols)));
    room.status = "ended";
    return { state: "revealed", cells, result: "boom", started };
  }

  const region = floodReveal(mines, rows, cols, row, col);
  const newly: RevealedCell[] = [];
  for (const c of region) {
    const ci = cellIndex(c.row, c.col, cols);
    if (!room.revealed.has(ci)) {
      room.revealed.add(ci);
      newly.push(c);
    }
  }
  const result: CellOpResult = checkWin(room) ? "win" : "clear";
  if (result === "win") room.status = "ended";
  return { state: "revealed", cells: newly, result, started };
}

export function flagCell(room: ServerRoom, row: number, col: number): CellOpOutcome {
  ensurePlaying(room);
  const cols = room.config!.cols;
  const idx = cellIndex(row, col, cols);
  if (room.revealed.has(idx)) return { state: "revealed", cells: [], result: "clear" };
  const cur = room.flags.get(idx) ?? "hidden";
  const next: CellState = cur === "hidden" ? "flagged" : cur === "flagged" ? "question" : "hidden";
  if (next === "hidden") room.flags.delete(idx);
  else room.flags.set(idx, next);
  return { state: next, cells: [], result: "clear" };
}

export function chordCell(room: ServerRoom, row: number, col: number): CellOpOutcome {
  const { rows, cols } = ensurePlaying(room);
  const mines = room.mines!;
  const idx = cellIndex(row, col, cols);
  if (!room.revealed.has(idx)) return { state: "hidden", cells: [], result: "clear" };

  const num = adjacentMines(mines, row, col, rows, cols);
  if (num === 0) return { state: "revealed", cells: [], result: "clear" };

  let flagCount = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      if (room.flags.get(cellIndex(r, c, cols)) === "flagged") flagCount++;
    }
  }
  if (flagCount !== num) return { state: "revealed", cells: [], result: "clear" };

  const newly: RevealedCell[] = [];
  let boom = false;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const ni = cellIndex(r, c, cols);
      if (room.flags.get(ni) === "flagged") continue;
      if (room.revealed.has(ni)) continue;
      if (isMine(mines, r, c, cols)) {
        boom = true;
        break;
      }
      const region = floodReveal(mines, rows, cols, r, c);
      for (const cell of region) {
        const ci = cellIndex(cell.row, cell.col, cols);
        if (!room.revealed.has(ci)) {
          room.revealed.add(ci);
          newly.push(cell);
        }
      }
    }
  }

  if (boom) {
    const cells = allMines(mines, cols);
    cells.forEach((mc) => room.revealed.add(cellIndex(mc.row, mc.col, cols)));
    room.status = "ended";
    return { state: "revealed", cells, result: "boom" };
  }
  const result: CellOpResult = checkWin(room) ? "win" : "clear";
  if (result === "win") room.status = "ended";
  return { state: "revealed", cells: newly, result };
}

export function findRoomByPlayer(playerId: string): ServerRoom | undefined {
  for (const room of roomStore.all()) {
    if (room.players.has(playerId)) return room;
  }
  return undefined;
}
