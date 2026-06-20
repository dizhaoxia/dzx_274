/**
 * Socket.IO 客户端封装：单一连接、统一 c2s 发送（自动注入 version）、s2c 订阅。
 */
import { io, type Socket } from "socket.io-client";
import {
  ALGO_VERSION,
  C2S_EVENT,
  S2C_EVENT,
} from "@shared/protocol";
import type { ClientMessage, ServerMessage } from "@shared/protocol";

/** 分布式 Omit：对判别联合体逐成员剔除字段，保留各变体独有字段。 */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

const DEV_URL = "http://localhost:54343";
const SOCKET_URL: string =
  (import.meta.env.VITE_SOCKET_URL as string | undefined) ??
  (import.meta.env.PROD ? "" : DEV_URL);

export const socket: Socket = io(SOCKET_URL || undefined, {
  autoConnect: false,
  transports: ["websocket"],
  reconnection: true,
  reconnectionDelay: 500,
});

export function send(msg: DistributiveOmit<ClientMessage, "version">): void {
  socket.emit(C2S_EVENT, { ...msg, version: ALGO_VERSION } as ClientMessage);
}

export function onMessage(handler: (msg: ServerMessage) => void): () => void {
  const listener = (msg: ServerMessage): void => handler(msg);
  socket.on(S2C_EVENT, listener);
  return () => socket.off(S2C_EVENT, listener);
}
