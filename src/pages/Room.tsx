/** 房间页：等待态展示等待大厅，进行中展示棋盘 + 侧栏。 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useGameStore } from "@/store/gameStore";
import { Board } from "@/components/Board";
import { GameOverlay } from "@/components/GameOverlay";
import { InviteCard } from "@/components/InviteCard";
import { LogPanel } from "@/components/LogPanel";
import { PlayerList } from "@/components/PlayerList";
import { StatusBar } from "@/components/StatusBar";
import { WaitingRoom } from "@/components/WaitingRoom";

export default function Room() {
  const navigate = useNavigate();
  const room = useGameStore((s) => s.room);
  const connected = useGameStore((s) => s.connected);
  const leaveRoom = useGameStore((s) => s.leaveRoom);

  useEffect(() => {
    if (!room) {
      const t = window.setTimeout(() => navigate("/", { replace: true }), 300);
      return () => window.clearTimeout(t);
    }
  }, [room, navigate]);

  if (!room) {
    return (
      <div className="grid flex-1 place-items-center font-mono text-sm text-zinc-500">
        {connected ? "房间已失效，正在返回大厅…" : "正在连接服务器…"}
      </div>
    );
  }

  if (room.status === "waiting") {
    return <WaitingRoom />;
  }

  const handleLeave = (): void => {
    leaveRoom();
    navigate("/");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StatusBar />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_320px]">
        <div className="relative grid min-h-0 place-items-center overflow-auto border border-ink-700 bg-ink-950/40">
          <Board />
          <GameOverlay />
        </div>
        <div className="scrollbar-thin flex min-h-0 flex-col gap-4 overflow-auto">
          <InviteCard />
          <div className="panel">
            <div className="flex items-center justify-between">
              <span className="font-display text-sm tracking-widest text-zinc-400">参战人员</span>
              <span className="tac-chip text-amber">{room.players.length} 在线</span>
            </div>
            <div className="mt-2">
              <PlayerList />
            </div>
          </div>
          <LogPanel />
          <button type="button" className="tac-btn text-danger" onClick={handleLeave}>
            <LogOut className="h-4 w-4" /> 离开房间
          </button>
        </div>
      </div>
    </div>
  );
}
