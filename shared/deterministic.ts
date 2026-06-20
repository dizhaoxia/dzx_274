/**
 * 确定性伪随机数发生器（DeterministicRandom）。
 * 前后端共用同一份源码，确保给定相同 seed 产出完全一致的随机序列。
 *
 * 算法：xfnv1a 哈希将种子字符串映射为 4 个 32 位状态字，再驱动 sfc32 生成序列。
 * sfc32 为已知的高质量、快速、可逆构造的 PRNG，跨运行环境行为一致。
 */

import { ALGO_VERSION } from "./protocol";

export class DeterministicRandom {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  readonly seed: string;
  readonly version: string;

  constructor(seed: string) {
    this.seed = seed;
    this.version = ALGO_VERSION;
    this.a = this.hashStr(seed + "#0");
    this.b = this.hashStr(seed + "#1");
    this.c = this.hashStr(seed + "#2");
    this.d = this.hashStr(seed + "#3");
  }

  /** xfnv1a 变种：将字符串映射为 32 位无符号整数 */
  private hashStr(input: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
      h = Math.imul(h ^ input.charCodeAt(i), 16777619);
    }
    return h >>> 0;
  }

  /** 产出下一个 32 位无符号整数（sfc32） */
  nextUint32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** 产出 [0,1) 区间的浮点数 */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /** 产出 [0, maxExclusive) 区间的整数 */
  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return this.nextUint32() % maxExclusive;
  }

  /** 产出 [minInclusive, maxExclusive) 区间的整数 */
  nextIntRange(minInclusive: number, maxExclusive: number): number {
    return minInclusive + this.nextInt(maxExclusive - minInclusive);
  }
}
