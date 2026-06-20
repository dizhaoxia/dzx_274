/**
 * Socket.IO 实时层：接入 HTTP 服务，处理客户端 c2s 消息并广播 s2c 消息。
 * - 校验每条消息的 version 字段。
 * - 调用 roomService 完成权威计算，向操作者回 cell:ack，向他人广播 cell:broadcast。
 * - 维护每秒一次的服务端权威时间广播。
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
} from "@shared/protocol";
import {
  ServiceError,
  chordCell,
  createRoom,
  flagCell,
  findRoomByPlayer,
  joinRoom,
  leaveRoom,
  revealCell,
  resetGame,
  setReady,
  snapshot,
  startGame,
} from "./roomService";
import { roomStore } from "./store";

const VERSION = ALGO_VERSION;

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
  });
}

function handleCellOp(
  io: IoServer,
  socket: Socket,
  opId: string,
  row: number,
  col: number,
  kind: "reveal" | "flag" | "chord",
): void {
  const room = findRoomByPlayer(socket.id);
  if (!room) {
    sendError(socket, "NOT_IN_ROOM", "你不在任何房间内");
    return;
  }
  let outcome;
  try {
    if (kind === "reveal") outcome = revealCell(room, row, col);
    else if (kind === "flag") outcome = flagCell(room, row, col);
    else outcome = chordCell(room, row, col);
  } catch (err) {
    const code = err instanceof ServiceError ? err.code : "INTERNAL";
    const message = err instanceof Error ? err.message : "内部错误";
    send(socket, {
      type: "cell:ack",
      version: VERSION,
      opId,
      ok: false,
      row,
      col,
      state: "hidden",
      cells: [],
    });
    sendError(socket, code, message);
    return;
  }
  const playerName = (socket.data?.name as string | undefined) ?? "玩家";

  send(socket, {
    type: "cell:ack",
    version: VERSION,
    opId,
    ok: true,
    row,
    col,
    state: outcome.state,
    cells: outcome.cells,
    result: outcome.result,
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
  });

  if (outcome.started) emitGameStarted(io, room.code);
  if (outcome.result === "boom" || outcome.result === "win") {
    emitRoomState(io, room.code);
  }
}

export function setupRealtime(httpServer: HttpServer): IoServer {
  const io = new IoServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e6,
  });

  io.on("connection", (socket: Socket) => {
    socket.on(C2S_EVENT, (raw: unknown) => {
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
            if (room.status === "playing" && room.config) {
              send(socket, { type: "game:config", version: VERSION, config: room.config });
              if (room.gameStartTimestamp) {
                send(socket, {
                  type: "game:started",
                  version: VERSION,
                  gameStartTimestamp: room.gameStartTimestamp,
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
          handleCellOp(io, socket, msg.opId, msg.row, msg.col, "reveal");
          break;
        case "cell:flag":
          handleCellOp(io, socket, msg.opId, msg.row, msg.col, "flag");
          break;
        case "cell:chord":
          handleCellOp(io, socket, msg.opId, msg.row, msg.col, "chord");
          break;
        case "time:sync":
          send(socket, { type: "time:sync", version: VERSION, serverTime: Date.now() });
          break;
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

  // 每秒广播服务端权威时间到进行中的房间
  setInterval(() => {
    for (const room of roomStore.all()) {
      if (room.status === "playing") {
        io.to(room.code).emit(S2C_EVENT, {
          type: "time:sync",
          version: VERSION,
          serverTime: Date.now(),
        });
      }
    }
  }, 1000);

  return io;
}
