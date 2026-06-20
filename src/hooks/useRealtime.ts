/**
 * 建立 Socket.IO 连接，订阅 s2c 消息并派发到 store。
 * 在应用根组件调用一次即可。
 */
import { useEffect } from "react";
import { onMessage, socket } from "@/lib/socket";
import { useGameStore } from "@/store/gameStore";

export function useRealtime(): void {
  const applyMessage = useGameStore((s) => s.applyMessage);
  const setConnected = useGameStore((s) => s.setConnected);
  const setMyId = useGameStore((s) => s.setMyId);

  useEffect(() => {
    const off = onMessage((msg) => applyMessage(msg));
    const onConnect = (): void => {
      setConnected(true);
      setMyId(socket.id ?? "");
    };
    const onDisconnect = (): void => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.connect();

    return () => {
      off();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [applyMessage, setConnected, setMyId]);
}
