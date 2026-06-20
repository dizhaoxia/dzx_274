/** 大厅页：输入昵称、选择难度创建房间，或输入邀请码加入房间。 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bomb, ChevronRight, LogIn, Plus, Wifi, WifiOff } from "lucide-react";
import { DIFFICULTY_LABELS, type Difficulty } from "@shared/protocol";
import { useGameStore } from "@/store/gameStore";
import { cn } from "@/lib/utils";

const DIFFS: Difficulty[] = ["beginner", "intermediate", "expert"];

const PRESET: Record<Difficulty, { dims: string; mines: string }> = {
  beginner: { dims: "9 × 9", mines: "10" },
  intermediate: { dims: "16 × 16", mines: "40" },
  expert: { dims: "16 × 30", mines: "99" },
};

export default function Lobby() {
  const navigate = useNavigate();
  const room = useGameStore((s) => s.room);
  const connected = useGameStore((s) => s.connected);
  const createRoom = useGameStore((s) => s.createRoom);
  const joinRoom = useGameStore((s) => s.joinRoom);

  const [name, setName] = useState<string>(() => {
    try {
      return localStorage.getItem("coop_ms_name") ?? "";
    } catch {
      return "";
    }
  });
  const [code, setCode] = useState("");
  const [diff, setDiff] = useState<Difficulty>("beginner");

  useEffect(() => {
    if (room) navigate(`/room/${room.code}`, { replace: true });
  }, [room, navigate]);

  const handleCreate = (): void => {
    if (!name.trim() || !connected) return;
    createRoom(name.trim(), diff);
  };
  const handleJoin = (): void => {
    if (!name.trim() || !code.trim() || !connected) return;
    joinRoom(code.trim().toUpperCase(), name.trim());
  };

  return (
    <div className="scrollbar-thin grid flex-1 place-items-center overflow-auto p-6">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center border border-amber/40 bg-amber/10 text-amber shadow-glow-amber">
            <Bomb className="h-7 w-7" />
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-[0.3em] text-zinc-100">
            协同排雷
          </h1>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.35em] text-zinc-500">
            COOP MINESWEEPER · TACTICAL EDITION
          </p>
        </div>

        <div className="panel mb-4">
          <label className="font-display text-sm tracking-widest text-zinc-400">指挥官代号</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            placeholder="输入你的昵称…"
            className="mt-2 w-full border border-ink-700 bg-ink-950/60 px-3 py-2 font-mono text-zinc-100 outline-none focus:border-amber/60"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel flex flex-col">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-amber" />
              <span className="font-display text-sm tracking-widest text-zinc-300">创建房间</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {DIFFS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDiff(d)}
                  className={cn(
                    "border px-2 py-2 text-center transition-colors",
                    diff === d
                      ? "border-amber bg-amber/10 text-amber"
                      : "border-ink-700 bg-ink-800/40 text-zinc-400 hover:border-amber/40",
                  )}
                >
                  <div className="font-display text-sm">{DIFFICULTY_LABELS[d]}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-zinc-500">{PRESET[d].dims}</div>
                  <div className="font-mono text-[10px] text-zinc-500">{PRESET[d].mines} 雷</div>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!name.trim() || !connected}
              className="tac-btn-primary mt-3 disabled:cursor-not-allowed disabled:opacity-40"
            >
              创建 <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="panel flex flex-col">
            <div className="flex items-center gap-2">
              <LogIn className="h-4 w-4 text-emerald" />
              <span className="font-display text-sm tracking-widest text-zinc-300">加入房间</span>
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="6 位邀请码"
              className="mt-3 w-full border border-ink-700 bg-ink-950/60 px-3 py-2 text-center font-mono text-2xl tracking-[0.4em] text-emerald outline-none focus:border-emerald/60"
            />
            <button
              type="button"
              onClick={handleJoin}
              disabled={!name.trim() || code.length < 6 || !connected}
              className="tac-btn-success mt-3 disabled:cursor-not-allowed disabled:opacity-40"
            >
              加入 <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 font-mono text-xs text-zinc-500">
          {connected ? (
            <>
              <Wifi className="h-3.5 w-3.5 text-emerald" /> 已连接服务器
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5 text-danger" /> 正在连接服务器…
            </>
          )}
        </div>
      </div>
    </div>
  );
}
