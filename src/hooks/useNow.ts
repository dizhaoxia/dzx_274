/**
 * 每隔 intervalMs 更新一次本地时间戳，用于驱动计时器重渲染。
 * 
 * v2.0 新增：
 * - 使用 requestAnimationFrame 实现 60fps 平滑更新
 * - 支持与平滑插值计时系统集成
 */
import { useEffect, useRef, useState } from "react";

export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState<number>(() => Date.now());
  const rafRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    const update = (): void => {
      const t = Date.now();
      if (t - lastUpdateRef.current >= intervalMs) {
        setNow(t);
        lastUpdateRef.current = t;
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [intervalMs]);
  return now;
}

export function usePerformanceNow(): number {
  const [now, setNow] = useState<number>(() => performance.now());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const update = (): void => {
      setNow(performance.now());
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);
  return now;
}
