/** 邀请码卡片：展示 6 位邀请码、难度、状态、哈希校验、游戏配置（种子/行列/雷数）。 */
import { Check, Copy, ShieldCheck, ShieldAlert, Ticket, Hash } from "lucide-react";
import { useState } from "react";
import { DIFFICULTY_LABELS } from "@shared/protocol";
import { useGameStore } from "@/store/gameStore";

function Info({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="border border-ink-700 bg-ink-900/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div
        className={`mt-0.5 truncate ${highlight ? "text-amber font-bold" : "text-zinc-200"}`}
      >
        {value}
      </div>
    </div>
  );
}

export function InviteCard() {
  const room = useGameStore((s) => s.room);
  const config = useGameStore((s) => s.config);
  const hashVerified = useGameStore((s) => s.hashVerified);
  const [copied, setCopied] = useState(false);
  if (!room) return null;

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const statusLabel =
    room.status === "waiting" ? "等待中" : room.status === "playing" ? "进行中" : "已结束";

  return (
    <div className="panel">
      <div className="flex items-center gap-2 text-zinc-400">
        <Ticket className="h-4 w-4 text-amber" />
        <span className="font-display text-sm tracking-widest">邀请码</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="font-mono text-3xl font-bold tracking-[0.4em] text-amber shadow-glow-amber">
          {room.code}
        </span>
        <button type="button" className="tac-btn" onClick={() => copy(room.code)}>
          {copied ? (
            <Check className="h-4 w-4 text-emerald" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs">
        <Info label="难度" value={DIFFICULTY_LABELS[room.difficulty]} />
        <Info label="状态" value={statusLabel} />
        <Info label="哈希" value={hashVerified ? "VERIFIED" : "—"} highlight={hashVerified} />
      </div>

      {config && (
        <>
          <div className="mt-4 border-t border-ink-700 pt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
              <Hash className="h-3.5 w-3.5" />
              全局种子 / Game Config
            </div>
            <div className="space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-500 whitespace-nowrap">Seed</span>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <code className="truncate rounded bg-ink-800 px-2 py-0.5 text-amber">
                    {config.seed}
                  </code>
                  <button
                    type="button"
                    className="tac-btn shrink-0 !px-2 !py-1"
                    onClick={() => copy(config.seed)}
                    title="复制种子"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs">
            <Info label="行 Rows" value={String(config.rows)} highlight />
            <Info label="列 Cols" value={String(config.cols)} highlight />
            <Info label="雷数 Mines" value={String(config.mineCount)} highlight />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 font-mono text-xs">
            <Info label="MineHash (djb2)" value={config.mineHash} />
          </div>
        </>
      )}

      {hashVerified && (
        <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-emerald">
          <ShieldCheck className="h-3.5 w-3.5" />
          雷位哈希校验通过 · 前后端地图一致
        </p>
      )}
      {config && !hashVerified && (
        <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-danger">
          <ShieldAlert className="h-3.5 w-3.5" />
          ⚠ 哈希校验失败 · 算法版本可能不一致
        </p>
      )}
      {!config && (
        <p className="mt-2 font-mono text-[11px] text-zinc-500">
          点击「开始排雷」后，服务端下发全局种子，客户端本地生成棋盘。
        </p>
      )}
    </div>
  );
}
