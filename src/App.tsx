/** 应用根：路由、战术背景、状态栏、实时连接与全局错误提示。 */
import { useEffect } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import { Background } from "@/components/Background";
import { Header } from "@/components/Header";
import { useRealtime } from "@/hooks/useRealtime";
import { useGameStore } from "@/store/gameStore";
import Lobby from "@/pages/Lobby";
import Room from "@/pages/Room";

function ErrorToast() {
  const error = useGameStore((s) => s.error);
  const clearError = useGameStore((s) => s.clearError);
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => clearError(), 4000);
    return () => window.clearTimeout(t);
  }, [error, clearError]);
  if (!error) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 border border-danger/50 bg-ink-900 px-4 py-2 font-mono text-sm text-danger shadow-glow-danger">
      {error}
    </div>
  );
}

export default function App() {
  useRealtime();
  return (
    <Router>
      <Background />
      <div className="flex h-screen flex-col text-zinc-100">
        <Header />
        <main className="flex min-h-0 flex-1 flex-col">
          <Routes>
            <Route path="/" element={<Lobby />} />
            <Route path="/room/:code" element={<Room />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <ErrorToast />
      </div>
    </Router>
  );
}
