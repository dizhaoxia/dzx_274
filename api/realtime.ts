/**
 * Socket.IO 实时层：接入 HTTP 服务，处理客户端 c2s 消息并广播 s2c 消息。
 * - 校验每条消息的 version 字段。
 * - 调用 roomService 完成权威计算，向操作者回 cell:ack，向他人广播 cell:broadcast。
 * - 维护每 500ms 一次的服务端权威时间广播。
 * 
 * v2.0 新增：
 * - 分布式锁获取与失败回滚处理
 * - 版本号管理与增量同步
 * - 游戏结束广播 (game:over / game:victory)
 * - 暂停/继续广播
 * - 同种子/新种子重开
 * - 增强的时间同步（延迟补偿）
 */
import { type Server as HttpServer } from "http";
import { Server as IoServer, type Socket } from "socket.io";
import {
  ALGO_VERSION,
  C2S_EVENT,
  S2C_EVENT,
} from "@shared/protocol";
import type {
  ClientMessage,
  ServerMessage,
  CellState,
} from "@shared/protocol";
import {
  ServiceError,
  chordCell,
  createRoom,
  flagCell,
  findRoomByPlayer,
  getCurrentCellState,
  getIncrementalState,
  joinRoom,
  leaveRoom,
  pauseGame,
  resetGame,
  restartGame,
  resumeGame,
  setReady,
  snapshot,
  startGame,
  revealCell,
} from "./roomService";
import { roomStore } from "./store";
import { lockManager, type LockHandle } from "./lockManager";

const VERSION = ALGO_VERSION;
const TIME_BROADCAST_INTERVAL_MS = 500;

function send(socket: Socket, msg: ServerMessage): void {
  socket.emit(S2C_EVENT, msg);
}

function sendError(socket: Socket, code: string, message: string): void {
  send(socket, { type: "error", version: VERSION, code, message });
}

function emitRoomState(io: IoServer, code: string): void {
  const room = roomStore.get(code);
  if (!room) return;
  io.to(code).emit(S2C_EVENT, { type: "room:state", version: VERSION, room: snapshot(room) });
}

function emitGameConfig(io: IoServer, code: string): void {
  const room = roomStore.get(code);
  if (!room || !room.config) return;
  io.to(code).emit(S2C_EVENT, { type: "game:config", version: VERSION, config: room.config });
}

function emitGameStarted(io: IoServer, code: string): void {
  const room = roomStore.get(code);
  if (!room || !room.gameStartTimestamp) return;
  io.to(code).emit(S2C_EVENT, {
    type: "game:started",
    version: VERSION,
    gameStartTimestamp: room.gameStartTimestamp,
    globalVersion: room.globalVersion,
  });
}

function emitGameOver(
  io: IoServer,
  code: string,
  playerId: string,
  playerName: string,
  row: number,
  col: number,
  cells: Array<{ row: number; col: number; adjacent: number; isMine: boolean }>,
  version: number,
): void {
  io.to(code).emit(S2C_EVENT, {
    type: "game:over",
    version: VERSION,
    explodedCell: { row, col },
    playerId,
    playerName,
    cells,
    globalVersion: version,
  });
}

function emitGameVictory(io: IoServer, code: string, version: number): void {
  io.to(code).emit(S2C_EVENT, {
    type: "game:victory",
    version: VERSION,
    globalVersion: version,
  });
}

function emitGamePaused(
  io: IoServer,
  code: string,
  pausedAt: number,
  pausedElapsed: number,
  version: number,
): void {
  io.to(code).emit(S2C_EVENT, {
    type: "game:paused",
    version: VERSION,
    pausedAt,
    pausedElapsed,
    globalVersion: version,
  });
}

function emitGameResumed(io: IoServer, code: string, resumedAt: number, version: number): void {
  io.to(code).emit(S2C_EVENT, {
    type: "game:resumed",
    version: VERSION,
    resumedAt,
    globalVersion: version,
  });
}

function emitStateDelta(
  socket: Socket,
  delta: {
    fromVersion: number;
    toVersion: number;
    revealed: Array<{ row: number; col: number; adjacent: number; isMine: boolean }>;
    flags: Array<{ row: number; col: number; state: CellState }>;
    status?: "waiting" | "playing" | "paused" | "ended";
    explodedCell?: { row: number; col: number } | null;
  },
): void {
  send(socket, {
    type: "state:delta",
    version: VERSION,
    delta,
  });
}

function sendRollbackAck(
  socket: Socket,
  opId: string,
  row: number,
  col: number,
  currentState: CellState,
  version: number,
  incrementalState?: {
    fromVersion: number;
    toVersion: number;
    revealed: Array<{ row: number; col: number; adjacent: number; isMine: boolean }>;
    flags: Array<{ row: number; col: number; state: CellState }>;
    status?: "waiting" | "playing" | "paused" | "ended";
    explodedCell?: { row: number; col: number } | null;
  },
): void {
  send(socket, {
    type: "cell:ack",
    version: VERSION,
    opId,
    ok: false,
    rollback: true,
    row,
    col,
    state: currentState,
    cells: [],
    globalVersion: version,
    incrementalState,
  });
}

async function handleCellOp(
  io: IoServer,
  socket: Socket,
  opId: string,
  row: number,
  col: number,
  kind: "reveal" | "flag" | "chord",
  clientVersion: number,
): Promise<void> {
  const room = findRoomByPlayer(socket.id);
  if (!room) {
    sendError(socket, "NOT_IN_ROOM", "你不在任何房间内");
    return;
  }

  if (room.frozen || room.status === "ended") {
    const currentState = getCurrentCellState(room, row, col);
    const delta = getIncrementalState(room, clientVersion);
    sendRollbackAck(socket, opId, row, col, currentState, room.globalVersion, delta ?? undefined);
    return;
  }

  let lock: LockHandle | null = null;
  try {
    lock = await lockManager.tryAcquire(room.code, row, col);
    
    if (!lock) {
      const currentState = getCurrentCellState(room, row, col);
      const delta = getIncrementalState(room, clientVersion);
      sendRollbackAck(socket, opId, row, col, currentState, room.globalVersion, delta ?? undefined);
      return;
    }

    if (clientVersion < room.globalVersion) {
      const delta = getIncrementalState(room, clientVersion);
      if (delta) {
        emitStateDelta(socket, delta);
      }
    }

    let outcome;
    try {
      if (kind === "reveal") outcome = revealCell(room, row, col, clientVersion);
      else if (kind === "flag") outcome = flagCell(room, row, col, clientVersion);
      else outcome = chordCell(room, row, col, clientVersion);
    } catch (err) {
      const code = err instanceof ServiceError ? err.code : "INTERNAL";
      const message = err instanceof Error ? err.message : "内部错误";
      const currentState = getCurrentCellState(room, row, col);
      const delta = getIncrementalState(room, clientVersion);
      send(socket, {
        type: "cell:ack",
        version: VERSION,
        opId,
        ok: false,
        rollback: true,
        row,
        col,
        state: currentState,
        cells: [],
        globalVersion: room.globalVersion,
        incrementalState: delta ?? undefined,
      });
      sendError(socket, code, message);
      return;
    }

    const playerName = (socket.data?.name as string | undefined) ?? "玩家";
    const delta = outcome.rollbackRequired ? getIncrementalState(room, clientVersion) ?? undefined : undefined;

    send(socket, {
      type: "cell:ack",
      version: VERSION,
      opId,
      ok: true,
      rollback: outcome.rollbackRequired,
      row,
      col,
      state: outcome.state,
      cells: outcome.cells,
      result: outcome.result,
      globalVersion: outcome.version,
      incrementalState: delta,
    });

    socket.to(room.code).emit(S2C_EVENT, {
      type: "cell:broadcast",
      version: VERSION,
      playerId: socket.id,
      playerName,
      row,
      col,
      state: outcome.state,
      cells: outcome.cells,
      result: outcome.result,
      globalVersion: outcome.version,
    });

    if (outcome.started) {
      emitGameStarted(io, room.code);
    }

    if (outcome.result === "boom") {
      emitGameOver(io, room.code, socket.id, playerName, row, col, outcome.cells, outcome.version);
      emitRoomState(io, room.code);
    } else if (outcome.result === "win") {
      emitGameVictory(io, room.code, outcome.version);
      emitRoomState(io, room.code);
    }
  } finally {
    if (lock) {
      await lock.release();
    }
  }
}

export function setupRealtime(httpServer: HttpServer): IoServer {
  const io = new IoServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e6,
  });

  io.on("connection", (socket: Socket) => {
    socket.on(C2S_EVENT, async (raw: unknown) => {
      const msg = raw as ClientMessage;
      if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") {
        sendError(socket, "BAD_MESSAGE", "消息格式错误");
        return;
      }
      if ((msg as { version?: string }).version !== ALGO_VERSION) {
        sendError(
          socket,
          "VERSION_MISMATCH",
          `算法版本不匹配（服务端 ${ALGO_VERSION}，客户端 ${(msg as { version?: string }).version}）`,
        );
        return;
      }

      switch (msg.type) {
        case "room:create": {
          const room = createRoom(socket.id, msg.playerName, msg.difficulty);
          socket.data.name = msg.playerName;
          socket.data.code = room.code;
          socket.join(room.code);
          emitRoomState(io, room.code);
          break;
        }
        case "room:join": {
          try {
            const room = joinRoom(socket.id, msg.playerName, msg.code);
            socket.data.name = msg.playerName;
            socket.data.code = room.code;
            socket.join(room.code);
            emitRoomState(io, room.code);
            if ((room.status === "playing" || room.status === "paused") && room.config) {
              send(socket, { type: "game:config", version: VERSION, config: room.config });
              if (room.gameStartTimestamp) {
                send(socket, {
                  type: "game:started",
                  version: VERSION,
                  gameStartTimestamp: room.gameStartTimestamp,
                  globalVersion: room.globalVersion,
                });
              }
              if (room.status === "paused" && room.pausedAt && room.pausedElapsed) {
                send(socket, {
                  type: "game:paused",
                  version: VERSION,
                  pausedAt: room.pausedAt,
                  pausedElapsed: room.pausedElapsed,
                  globalVersion: room.globalVersion,
                });
              }
            }
          } catch (err) {
            const code = err instanceof ServiceError ? err.code : "JOIN_FAILED";
            const message = err instanceof Error ? err.message : "加入房间失败";
            sendError(socket, code, message);
          }
          break;
        }
        case "room:leave": {
          const code = socket.data?.code as string | undefined;
          leaveRoom(socket.id);
          socket.data.code = undefined;
          if (code) {
            socket.leave(code);
            emitRoomState(io, code);
          }
          break;
        }
        case "room:ready": {
          const room = findRoomByPlayer(socket.id);
          if (!room) {
            sendError(socket, "NOT_IN_ROOM", "你不在房间内");
            break;
          }
          setReady(room, socket.id, msg.ready);
          emitRoomState(io, room.code);
          break;
        }
        case "game:start": {
          const room = findRoomByPlayer(socket.id);
          if (!room) {
            sendError(socket, "NOT_IN_ROOM", "你不在房间内");
            break;
          }
          try {
            startGame(room, socket.id);
            emitGameConfig(io, room.code);
            emitRoomState(io, room.code);
          } catch (err) {
            const code = err instanceof ServiceError ? err.code : "START_FAILED";
            const message = err instanceof Error ? err.message : "开始游戏失败";
            sendError(socket, code, message);
          }
          break;
        }
        case "game:pause": {
          const room = findRoomByPlayer(socket.id);
          if (!room) {
            sendError(socket, "NOT_IN_ROOM", "你不在房间内");
            break;
          }
          try {
            const result = pauseGame(room, socket.id);
            emitGamePaused(io, room.code, result.pausedAt, result.pausedElapsed, room.globalVersion);
            emitRoomState(io, room.code);
          } catch (err) {
            const code = err instanceof ServiceError ? err.code : "PAUSE_FAILED";
            const message = err instanceof Error ? err.message : "暂停失败";
            sendError(socket, code, message);
          }
          break;
        }
        case "game:resume": {
          const room = findRoomByPlayer(socket.id);
          if (!room) {
            sendError(socket, "NOT_IN_ROOM", "你不在房间内");
            break;
          }
          try {
            const resumedAt = resumeGame(room, socket.id);
            emitGameResumed(io, room.code, resumedAt, room.globalVersion);
            emitRoomState(io, room.code);
          } catch (err) {
            const code = err instanceof ServiceError ? err.code : "RESUME_FAILED";
            const message = err instanceof Error ? err.message : "继续失败";
            sendError(socket, code, message);
          }
          break;
        }
        case "game:restart": {
          const room = findRoomByPlayer(socket.id);
          if (!room) break;
          try {
            restartGame(room, socket.id, msg.reuseSeed, msg.newSeed);
            emitGameConfig(io, room.code);
            emitRoomState(io, room.code);
          } catch (err) {
            const code = err instanceof ServiceError ? err.code : "RESTART_FAILED";
            const message = err instanceof Error ? err.message : "重新开始失败";
            sendError(socket, code, message);
          }
          break;
        }
        case "game:reset": {
          const room = findRoomByPlayer(socket.id);
          if (!room) break;
          try {
            resetGame(room, socket.id);
            emitRoomState(io, room.code);
          } catch (err) {
            const code = err instanceof ServiceError ? err.code : "RESET_FAILED";
            const message = err instanceof Error ? err.message : "重置失败";
            sendError(socket, code, message);
          }
          break;
        }
        case "cell:reveal":
          await handleCellOp(io, socket, msg.opId, msg.row, msg.col, "reveal", msg.stateVersion);
          break;
        case "cell:flag":
          await handleCellOp(io, socket, msg.opId, msg.row, msg.col, "flag", msg.stateVersion);
          break;
        case "cell:chord":
          await handleCellOp(io, socket, msg.opId, msg.row, msg.col, "chord", msg.stateVersion);
          break;
        case "time:sync": {
          const now = Date.now();
          const perfNow = performance.now();
          const room = findRoomByPlayer(socket.id);
          const authoritativeElapsed = room ? roomStore.getAuthoritativeElapsed(room, now) : 0;
          send(socket, {
            type: "time:sync",
            version: VERSION,
            serverTime: now,
            serverPerfTime: perfNow,
            clientTime: msg.clientTime,
            clientPerfTime: msg.clientPerfTime,
            authoritativeElapsed,
          });
          break;
        }
        case "state:pull": {
          const room = findRoomByPlayer(socket.id);
          if (!room) {
            sendError(socket, "NOT_IN_ROOM", "你不在房间内");
            break;
          }
          const delta = getIncrementalState(room, msg.fromVersion);
          if (delta) {
            emitStateDelta(socket, delta);
          }
          break;
        }
        default:
          sendError(socket, "UNKNOWN_TYPE", `未知消息类型: ${(msg as { type: string }).type}`);
      }
    });

    socket.on("disconnect", () => {
      const code = socket.data?.code as string | undefined;
      const result = leaveRoom(socket.id);
      if (code && !result.deleted) {
        emitRoomState(io, code);
      }
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const room of roomStore.all()) {
      if (room.status === "playing" || room.status === "paused") {
        const authoritativeElapsed = roomStore.getAuthoritativeElapsed(room, now);
        io.to(room.code).emit(S2C_EVENT, {
          type: "time:authoritative",
          version: VERSION,
          serverTime: now,
          authoritativeElapsed,
          isPaused: room.status === "paused",
        });
      }
    }
  }, TIME_BROADCAST_INTERVAL_MS);

  return io;
}
