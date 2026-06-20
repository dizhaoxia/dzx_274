/**
 * 房间与游戏的权威逻辑层。
 * 所有翻格/标旗/双击结果均由本模块基于 shared 算法计算，服务端为唯一权威。
 * 本模块不直接接触 Socket.IO，只返回结构化结果，由 realtime 层负责广播。
 * 
 * v2.0 新增：
 * - 原子操作队列 + 版本号递增
 * - 批量操作拆解为原子指令序列
 * - 胜利/失败冻结机制
 * - 暂停/继续功能
 * - 同种子复盘 / 新种子重开
 * - 增量状态计算
 */
import { randomBytes } from "crypto";
import {
  DIFFICULTY_PRESETS,
  cellIndex,
} from "@shared/protocol";
import type {
  AtomicCellOp,
  AtomicOpResult,
  CellOpResult,
  CellState,
  GameConfig,
  IncrementalState,
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
  version: number;
  atomicResults?: AtomicOpResult[];
  rollbackRequired: boolean;
  currentCellState?: CellState;
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
    pausedAt: room.pausedAt,
    pausedElapsed: room.pausedElapsed,
    globalVersion: room.globalVersion,
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
    globalVersion: 0,
    stateHistory: [],
    frozen: false,
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
  room.globalVersion = 0;
  room.stateHistory = [];
  room.frozen = false;
  room.pausedAt = undefined;
  room.pausedElapsed = undefined;
  room.explodedCell = undefined;
  return config;
}

export function pauseGame(room: ServerRoom, playerId: string): { pausedAt: number; pausedElapsed: number } {
  if (room.hostId !== playerId) throw new ServiceError("NOT_HOST", "仅房主可暂停游戏");
  if (room.status !== "playing") throw new ServiceError("NOT_PLAYING", "游戏未在进行中");
  const now = Date.now();
  room.status = "paused";
  room.pausedAt = now;
  room.pausedElapsed = room.gameStartTimestamp ? now - room.gameStartTimestamp : 0;
  return { pausedAt: now, pausedElapsed: room.pausedElapsed };
}

export function resumeGame(room: ServerRoom, playerId: string): number {
  if (room.hostId !== playerId) throw new ServiceError("NOT_HOST", "仅房主可继续游戏");
  if (room.status !== "paused") throw new ServiceError("NOT_PAUSED", "游戏未暂停");
  const now = Date.now();
  if (room.gameStartTimestamp && room.pausedAt) {
    const pausedDuration = now - room.pausedAt;
    room.gameStartTimestamp += pausedDuration;
  }
  room.status = "playing";
  room.pausedAt = undefined;
  room.pausedElapsed = undefined;
  return now;
}

export function restartGame(
  room: ServerRoom,
  playerId: string,
  reuseSeed: boolean,
  newSeed?: string,
): GameConfig {
  if (room.hostId !== playerId) throw new ServiceError("NOT_HOST", "仅房主可重新开始");
  if (!room.config) throw new ServiceError("NO_CONFIG", "没有可重开的游戏");
  
  const preset = DIFFICULTY_PRESETS[room.difficulty];
  let seed: string;
  if (reuseSeed) {
    seed = room.config.seed;
  } else if (newSeed && newSeed.trim()) {
    seed = newSeed.trim();
  } else {
    seed = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  }
  
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
  room.globalVersion = 0;
  room.stateHistory = [];
  room.frozen = false;
  room.pausedAt = undefined;
  room.pausedElapsed = undefined;
  room.explodedCell = undefined;
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
  room.globalVersion = 0;
  room.stateHistory = [];
  room.frozen = false;
  room.pausedAt = undefined;
  room.pausedElapsed = undefined;
  room.explodedCell = undefined;
  for (const p of room.players.values()) p.ready = false;
}

function ensurePlaying(room: ServerRoom): { rows: number; cols: number } {
  if (room.frozen) {
    throw new ServiceError("GAME_FROZEN", "游戏已结束，无法操作");
  }
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

export function getCurrentCellState(room: ServerRoom, row: number, col: number): CellState {
  const cols = room.config?.cols ?? 0;
  const idx = cellIndex(row, col, cols);
  if (room.revealed.has(idx)) return "revealed";
  return room.flags.get(idx) ?? "hidden";
}

function executeAtomicOp(
  room: ServerRoom,
  op: AtomicCellOp
): AtomicOpResult {
  const { rows, cols } = ensurePlaying(room);
  const mines = room.mines!;
  
  if (op.type === "reveal") {
    const idx = cellIndex(op.row, op.col, cols);
    
    if (room.revealed.has(idx)) {
      return { op, success: false, state: "revealed", cells: [] };
    }
    if (room.flags.get(idx) === "flagged") {
      return { op, success: false, state: "flagged", cells: [] };
    }

    if (isMine(mines, op.row, op.col, cols)) {
      const cells = allMines(mines, cols);
      cells.forEach((c) => room.revealed.add(cellIndex(c.row, c.col, cols)));
      room.frozen = true;
      room.explodedCell = idx;
      return { op, success: true, state: "revealed", cells, result: "boom" };
    }

    const region = floodReveal(mines, rows, cols, op.row, op.col);
    const newly: RevealedCell[] = [];
    for (const c of region) {
      const ci = cellIndex(c.row, c.col, cols);
      if (!room.revealed.has(ci)) {
        room.revealed.add(ci);
        newly.push(c);
      }
    }
    
    const win = checkWin(room);
    if (win) room.frozen = true;
    
    return { 
      op, 
      success: true, 
      state: "revealed", 
      cells: newly, 
      result: win ? "win" : "clear" 
    };
  } else {
    const idx = cellIndex(op.row, op.col, cols);
    if (room.revealed.has(idx)) {
      return { op, success: false, state: "revealed", cells: [] };
    }
    if (op.state === "hidden") room.flags.delete(idx);
    else room.flags.set(idx, op.state);
    
    return { op, success: true, state: op.state, cells: [] };
  }
}

export function decomposeChord(
  room: ServerRoom,
  row: number,
  col: number
): AtomicCellOp[] {
  const { rows, cols } = ensurePlaying(room);
  const mines = room.mines!;
  const idx = cellIndex(row, col, cols);
  
  const ops: AtomicCellOp[] = [];
  
  if (!room.revealed.has(idx)) return ops;
  
  const num = adjacentMines(mines, row, col, rows, cols);
  if (num === 0) return ops;
  
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
  
  if (flagCount !== num) return ops;
  
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const ni = cellIndex(r, c, cols);
      if (room.flags.get(ni) === "flagged") continue;
      if (room.revealed.has(ni)) continue;
      ops.push({ type: "reveal", row: r, col: c });
    }
  }
  
  return ops;
}

export function executeAtomicSequence(
  room: ServerRoom,
  ops: AtomicCellOp[]
): { results: AtomicOpResult[]; finalResult?: CellOpResult; started: boolean; allCells: RevealedCell[] } {
  const started = room.gameStartTimestamp === undefined;
  if (started) room.gameStartTimestamp = Date.now();

  const results: AtomicOpResult[] = [];
  let finalResult: CellOpResult = "clear";
  const allCells: RevealedCell[] = [];
  const seen = new Set<number>();
  
  for (const op of ops) {
    const result = executeAtomicOp(room, op);
    results.push(result);
    
    for (const cell of result.cells) {
      const idx = cellIndex(cell.row, cell.col, room.config!.cols);
      if (!seen.has(idx)) {
        seen.add(idx);
        allCells.push(cell);
      }
    }
    
    if (result.result === "boom" || result.result === "win") {
      finalResult = result.result;
      break;
    }
  }
  
  if (finalResult === "clear" && checkWin(room)) {
    finalResult = "win";
    room.frozen = true;
  }
  
  if (finalResult === "boom") {
    room.status = "ended";
  } else if (finalResult === "win") {
    room.status = "ended";
  }
  
  return { results, finalResult, started, allCells };
}

export function revealCell(room: ServerRoom, row: number, col: number, clientVersion: number): CellOpOutcome {
  const currentState = getCurrentCellState(room, row, col);
  
  if (room.revealed.has(cellIndex(row, col, room.config!.cols)) || 
      room.flags.get(cellIndex(row, col, room.config!.cols)) === "flagged") {
    return {
      state: currentState,
      cells: [],
      result: "clear",
      version: room.globalVersion,
      atomicResults: [],
      rollbackRequired: clientVersion !== room.globalVersion,
      currentCellState: currentState,
    };
  }
  
  const ops: AtomicCellOp[] = [{ type: "reveal", row, col }];
  const { results, finalResult, started, allCells } = executeAtomicSequence(room, ops);
  
  const revealedForHistory: RevealedCell[] = [];
  const flagsForHistory: Array<{ row: number; col: number; state: CellState }> = [];
  
  for (const r of results) {
    if (r.op.type === "reveal" && r.success) {
      revealedForHistory.push(...r.cells);
    }
  }
  
  const explodedCell = finalResult === "boom" ? { row, col } : null;
  const status = finalResult === "boom" || finalResult === "win" ? "ended" : undefined;
  
  roomStore.appendHistory(room, revealedForHistory, flagsForHistory, status, explodedCell);
  
  return {
    state: "revealed",
    cells: allCells,
    result: finalResult,
    started,
    version: room.globalVersion,
    atomicResults: results,
    rollbackRequired: clientVersion !== room.globalVersion,
    currentCellState: currentState,
  };
}

export function flagCell(room: ServerRoom, row: number, col: number, clientVersion: number): CellOpOutcome {
  const currentState = getCurrentCellState(room, row, col);
  
  if (room.revealed.has(cellIndex(row, col, room.config!.cols))) {
    return {
      state: "revealed",
      cells: [],
      result: "clear",
      version: room.globalVersion,
      atomicResults: [],
      rollbackRequired: clientVersion !== room.globalVersion,
      currentCellState: currentState,
    };
  }
  
  const cur = room.flags.get(cellIndex(row, col, room.config!.cols)) ?? "hidden";
  const next: CellState = cur === "hidden" ? "flagged" : cur === "flagged" ? "question" : "hidden";
  
  const ops: AtomicCellOp[] = [{ type: "flag", row, col, state: next }];
  const { results, started, allCells } = executeAtomicSequence(room, ops);
  
  const revealedForHistory: RevealedCell[] = [];
  const flagsForHistory: Array<{ row: number; col: number; state: CellState }> = [];
  
  for (const r of results) {
    if (r.op.type === "flag" && r.success) {
      flagsForHistory.push({ row, col, state: r.state });
    }
  }
  
  roomStore.appendHistory(room, revealedForHistory, flagsForHistory);
  
  return {
    state: next,
    cells: allCells,
    result: "clear",
    started,
    version: room.globalVersion,
    atomicResults: results,
    rollbackRequired: clientVersion !== room.globalVersion,
    currentCellState: currentState,
  };
}

export function chordCell(room: ServerRoom, row: number, col: number, clientVersion: number): CellOpOutcome {
  const currentState = getCurrentCellState(room, row, col);
  
  const ops = decomposeChord(room, row, col);
  
  if (ops.length === 0) {
    return {
      state: currentState,
      cells: [],
      result: "clear",
      version: room.globalVersion,
      atomicResults: [],
      rollbackRequired: clientVersion !== room.globalVersion,
      currentCellState: currentState,
    };
  }
  
  const { results, finalResult, started, allCells } = executeAtomicSequence(room, ops);
  
  const revealedForHistory: RevealedCell[] = [];
  const flagsForHistory: Array<{ row: number; col: number; state: CellState }> = [];
  
  for (const r of results) {
    if (r.op.type === "reveal" && r.success) {
      revealedForHistory.push(...r.cells);
    }
  }
  
  let explodedCell = null;
  if (finalResult === "boom") {
    const boomResult = results.find((r) => r.result === "boom");
    if (boomResult && boomResult.op.type === "reveal") {
      explodedCell = { row: boomResult.op.row, col: boomResult.op.col };
    }
  }
  const status = finalResult === "boom" || finalResult === "win" ? "ended" : undefined;
  
  roomStore.appendHistory(room, revealedForHistory, flagsForHistory, status, explodedCell);
  
  return {
    state: "revealed",
    cells: allCells,
    result: finalResult,
    started,
    version: room.globalVersion,
    atomicResults: results,
    rollbackRequired: clientVersion !== room.globalVersion,
    currentCellState: currentState,
  };
}

export function getIncrementalState(room: ServerRoom, fromVersion: number): IncrementalState | null {
  return roomStore.getDeltaSince(room, fromVersion);
}

export function findRoomByPlayer(playerId: string): ServerRoom | undefined {
  for (const room of roomStore.all()) {
    if (room.players.has(playerId)) return room;
  }
  return undefined;
}
