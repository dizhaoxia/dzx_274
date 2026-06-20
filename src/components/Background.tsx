/** 战术背景：栅格 + 径向渐隐 + 扫描线动效。 */
export function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      <div className="absolute inset-0 bg-grid-lines bg-grid-32 opacity-60" />
      <div className="absolute inset-0 bg-radial-fade" />
      <div className="absolute inset-x-0 h-48 bg-gradient-to-b from-amber/10 to-transparent animate-scanline" />
      <div className="absolute -top-32 left-1/2 h-72 w-[55%] -translate-x-1/2 rounded-full bg-amber/5 blur-3xl" />
      <div className="absolute bottom-0 left-1/2 h-40 w-[40%] -translate-x-1/2 rounded-full bg-emerald/5 blur-3xl" />
    </div>
  );
}
