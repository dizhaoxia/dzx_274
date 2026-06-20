/**
 * 分布式锁管理器：为每个格子提供细粒度的原子操作保护。
 * 
 * 设计原则：
 * 1. 支持两种后端：内存锁（开发/单实例）和 Redis 锁（生产/多实例）
 * 2. 锁粒度：cell:{roomCode}:{row}:{col}，每个格子独立锁
 * 3. 超时策略：获取锁超时 50ms，锁自动过期 5000ms（防止死锁）
 * 4. 先到先得：获取锁失败的请求直接返回当前状态，不排队
 * 
 * 使用方式：
 * const lock = await lockManager.tryAcquire(roomCode, row, col);
 * if (!lock) {
 *   // 返回当前格子最新状态，客户端回滚
 * }
 * try {
 *   // 执行操作
 * } finally {
 *   await lock.release();
 * }
 */

import { cellLockKey } from "@shared/protocol";

const LOCK_TIMEOUT_MS = 50;
const LOCK_TTL_MS = 5000;

export interface LockHandle {
  key: string;
  release: () => Promise<void>;
}

interface LockEntry {
  holder: symbol;
  expiresAt: number;
}

interface LockBackend {
  tryAcquire: (key: string, ttlMs: number) => Promise<boolean>;
  release: (key: string) => Promise<void>;
}

class InMemoryBackend implements LockBackend {
  private locks = new Map<string, LockEntry>();

  private gc(): void {
    const now = Date.now();
    for (const [key, entry] of this.locks.entries()) {
      if (entry.expiresAt < now) {
        this.locks.delete(key);
      }
    }
  }

  async tryAcquire(key: string, ttlMs: number): Promise<boolean> {
    this.gc();
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > now) {
      return false;
    }
    this.locks.set(key, {
      holder: Symbol("lockHolder"),
      expiresAt: now + ttlMs,
    });
    return true;
  }

  async release(key: string): Promise<void> {
    this.locks.delete(key);
  }
}

class RedisBackend implements LockBackend {
  private redisClient: unknown | null = null;
  private initialized = false;

  private async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      // 使用 eval 绕过 TypeScript 模块检查，运行时动态加载
      const redis = await eval('import("redis")').catch(() => null);
      if (!redis) {
        this.redisClient = null;
        return;
      }
      this.redisClient = (redis as { createClient: (opts: { url: string }) => unknown }).createClient({
        url: process.env.REDIS_URL ?? "",
      });
      const client = this.redisClient as { connect?: () => Promise<void>; on?: (event: string, handler: () => void) => void };
      if (client.connect) {
        client.connect().catch(() => {
          this.redisClient = null;
        });
      }
      if (client.on) {
        client.on("error", () => {
          this.redisClient = null;
        });
      }
    } catch {
      this.redisClient = null;
    }
  }

  async tryAcquire(key: string, ttlMs: number): Promise<boolean> {
    await this.init();
    if (!this.redisClient) {
      return false;
    }
    try {
      const client = this.redisClient as {
        set?: (key: string, value: string, options: { NX: boolean; PX: number }) => Promise<string | null>;
      };
      if (!client.set) return false;
      const result = await client.set(key, "1", { NX: true, PX: ttlMs });
      return result === "OK";
    } catch {
      return false;
    }
  }

  async release(key: string): Promise<void> {
    if (!this.redisClient) return;
    try {
      const client = this.redisClient as {
        del?: (key: string) => Promise<number>;
      };
      if (client.del) {
        await client.del(key);
      }
    } catch {
      /* ignore */
    }
  }
}

class LockManager {
  private backend: LockBackend;
  private useRedis: boolean;

  constructor() {
    this.useRedis = process.env.REDIS_URL !== undefined;
    this.backend = this.useRedis ? new RedisBackend() : new InMemoryBackend();
  }

  getBackendType(): "memory" | "redis" {
    return this.useRedis ? "redis" : "memory";
  }

  async tryAcquire(
    roomCode: string,
    row: number,
    col: number,
    timeoutMs: number = LOCK_TIMEOUT_MS
  ): Promise<LockHandle | null> {
    const key = cellLockKey(roomCode, row, col);
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const acquired = await this.backend.tryAcquire(key, LOCK_TTL_MS);
      if (acquired) {
        return {
          key,
          release: async () => {
            await this.backend.release(key);
          },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    
    return null;
  }

  async tryAcquireBatch(
    roomCode: string,
    cells: Array<{ row: number; col: number }>,
    timeoutMs: number = LOCK_TIMEOUT_MS
  ): Promise<Array<LockHandle> | null> {
    const sortedCells = [...cells].sort((a, b) => {
      const keyA = cellLockKey(roomCode, a.row, a.col);
      const keyB = cellLockKey(roomCode, b.row, b.col);
      return keyA.localeCompare(keyB);
    });

    const handles: LockHandle[] = [];
    const startTime = Date.now();

    for (const cell of sortedCells) {
      const remaining = timeoutMs - (Date.now() - startTime);
      if (remaining <= 0) {
        for (const h of handles) {
          await h.release();
        }
        return null;
      }
      const handle = await this.tryAcquire(roomCode, cell.row, cell.col, remaining);
      if (!handle) {
        for (const h of handles) {
          await h.release();
        }
        return null;
      }
      handles.push(handle);
    }

    return handles;
  }
}

export const lockManager = new LockManager();
