// Runs once when the server starts, on the Node runtime: pulls backend logs every 15 s
// (src/server/logSync.ts) and runs the watch loop every 30 s (src/server/monitor.ts: ops status,
// health probes, history, detection rules).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLogSync } = await import("./server/logSync");
  startLogSync();
  const { startMonitor } = await import("./server/monitor");
  startMonitor();
}
