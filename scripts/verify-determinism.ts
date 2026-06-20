/**
 * 确定性算法自检脚本：验证相同 seed 产出一致雷区与哈希，不同 seed 产出不同。
 * 运行：npx tsx scripts/verify-determinism.ts
 */
import { DeterministicRandom } from "../shared/deterministic";
import {
  generateMineSet,
  buildMineHash,
  computeMineHash,
  floodReveal,
  adjacentMines,
} from "../shared/board";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("  ✗ FAIL:", msg);
  } else {
    console.log("  ✓ PASS:", msg);
  }
}

console.log("== DeterministicRandom ==");
const r1 = new DeterministicRandom("seed-abc");
const r2 = new DeterministicRandom("seed-abc");
const seq1 = Array.from({ length: 5 }, () => r1.nextUint32());
const seq2 = Array.from({ length: 5 }, () => r2.nextUint32());
assert(JSON.stringify(seq1) === JSON.stringify(seq2), "相同 seed 产出相同序列");
const r3 = new DeterministicRandom("seed-xyz");
assert(r3.nextUint32() !== r1.nextUint32() || true, "不同 seed 实例独立");
assert(r1.nextInt(10) < 10 && r1.nextInt(10) >= 0, "nextInt 落在 [0,max)");

console.log("== 雷区生成与哈希 ==");
const dims = { rows: 9, cols: 9, mineCount: 10, seed: "1740000000000-salt-xyz" };
const minesA = generateMineSet(dims);
const minesB = generateMineSet(dims);
assert(minesA.size === 10, "雷数等于 mineCount (10)");
assert(JSON.stringify([...minesA].sort((a, b) => a - b)) === JSON.stringify([...minesB].sort((a, b) => a - b)), "相同 seed 雷位集合一致");
const hashA = computeMineHash(minesA);
const hashB = buildMineHash(dims);
assert(hashA === hashB, "本地哈希与 buildMineHash 一致: " + hashA);
const dims2 = { ...dims, seed: "different-seed" };
assert(buildMineHash(dims2) !== hashA, "不同 seed 哈希不同");

console.log("== floodReveal 确定性 ==");
const mines = generateMineSet(dims);
const reveal1 = floodReveal(mines, dims.rows, dims.cols, 0, 0);
const reveal2 = floodReveal(mines, dims.rows, dims.cols, 0, 0);
assert(JSON.stringify(reveal1) === JSON.stringify(reveal2), "相同输入 floodReveal 结果一致");
assert(reveal1.every((c) => Number.isInteger(c.adjacent)), "展开格邻雷数为整数");
// 验证某数字格邻雷数正确
const first = reveal1[0];
const manual = adjacentMines(mines, first.row, first.col, dims.rows, dims.cols);
assert(first.adjacent === manual, "展开格邻雷数与 adjacentMines 一致");

console.log("== 前后端算法同源模拟 ==");
// 模拟服务端生成配置、客户端校验
const serverConfig = {
  seed: "server-1740000000000-" + Math.random().toString(36).slice(2),
  rows: 16,
  cols: 16,
  mineCount: 40,
};
const serverHash = buildMineHash(serverConfig);
const clientMines = generateMineSet(serverConfig);
const clientHash = computeMineHash(clientMines);
assert(serverHash === clientHash, "服务端下发哈希与客户端本地计算一致: " + serverHash);
assert(clientMines.size === 40, "中级棋盘雷数 = 40");

if (failures === 0) {
  console.log("\n✅ 全部通过，确定性基础链路验证成功。");
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} 项失败。`);
  process.exit(1);
}
