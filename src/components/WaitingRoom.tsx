/** 等待大厅：邀请码 + 玩家列表 + 准备/开始/离开。 */
import { LogOut, Play, UserCheck, UserX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DIFFICULTY_LABELS } from "@shared/protocol";
import { useGameStore } from "@/store/gameStore";
import { cn } from "@/lib/utils";
import { InviteCard } from "./InviteCard";
import { LogPanel } from "./LogPanel";
import { PlayerList } from "./PlayerList";

export function WaitingRoom() {
  const navigate = useNavigate();
  const room = useGameStore((s) => s.room);
  const myId = useGameStore((s) => s.myId);
  const setReady = useGameStore((s) => s.setReady);
  const startGame = useGameStore((s) => s.startGame);
  const leaveRoom = useGameStore((s) => s.leaveRoom);

  if (!room) return null;
  const me = room.players.find((p) => p.id === myId);
  const isHost = me?.isHost ?? false;
  const myReady = me?.ready ?? false;
  const allReady = room.players.every((p) => p.ready || p.isHost);

  const handleLeave = (): void => {
    leaveRoom();
    navigate("/");
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4 overflow-auto">
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
        <div className="flex flex-col gap-2">
          {isHost ? (
            <button
              type="button"
              className={cn("tac-btn-primary", !allReady && "opacity-40")}
              disabled={!allReady}
              onClick={startGame}
            >
              <Play className="h-4 w-4" /> 开始排雷
            </button>
          ) : (
            <button
              type="button"
              className={cn(myReady ? "tac-btn-success" : "tac-btn")}
              onClick={() => setReady(!myReady)}
            >
              {myReady ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
              {myReady ? "已准备" : "准备"}
            </button>
          )}
          <button type="button" className="tac-btn text-danger" onClick={handleLeave}>
            <LogOut className="h-4 w-4" /> 离开房间
          </button>
          {!allReady && room.players.length > 1 && (
            <p className="text-center font-mono text-[11px] text-zinc-500">
              等待全员准备…
            </p>
          )}
          {room.players.length === 1 && (
            <p className="text-center font-mono text-[11px] text-zinc-500">
              单人模式 · 可直接开始
            </p>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-4">
        <div className="panel grid grid-cols-3 gap-3 text-center">
          <Stat label="难度" value={DIFFICULTY_LABELS[room.difficulty]} />
          <Stat label="行列" value={presetDims(room.difficulty)} />
          <Stat label="雷数" value={presetMines(room.difficulty)} />
        </div>
        <LogPanel />
        <div className="panel">
          <h3 className="font-display text-sm tracking-widest text-zinc-400">操作指南</h3>
          <ul className="mt-2 space-y-1.5 font-mono text-xs text-zinc-400">
            <li>• 左键翻开格子 / 双击数字格快速展开（Chord）</li>
            <li>• 右键循环标记：插旗 → 问号 → 取消</li>
            <li>• 移动端长按格子可插旗</li>
            <li>• 所有操作本地即时生效，服务端 ACK 后固化</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function presetDims(d: string): string {
  if (d === "beginner") return "9 × 9";
  if (d === "intermediate") return "16 × 16";
  return "16 × 30";
}
function presetMines(d: string): string {
  if (d === "beginner") return "10";
  if (d === "intermediate") return "40";
  return "99";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-display text-lg text-amber">{value}</div>
    </div>
  );
}
