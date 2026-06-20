/** 操作日志面板：滚动展示房间事件流。 */
import { Terminal } from "lucide-react";
import { useGameStore } from "@/store/gameStore";

export function LogPanel() {
  const logs = useGameStore((s) => s.logs);
  return (
    <div className="panel flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 text-zinc-400">
        <Terminal className="h-4 w-4 text-amber" />
        <span className="font-display text-sm tracking-widest">操作日志</span>
      </div>
      <div className="scrollbar-thin mt-2 flex-1 overflow-auto font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-zinc-600">暂无操作…</p>
        ) : (
          logs.map((l) => (
            <div key={l.id} className="border-l border-ink-700 py-0.5 pl-2 text-zinc-400">
              <span className="text-zinc-600">{">"}</span>{" "}
              <span className="text-zinc-500">[{l.player}]</span> {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
