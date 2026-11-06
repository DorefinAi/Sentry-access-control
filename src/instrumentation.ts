// Runs once when the server starts: begins pulling backend logs (src/server/logSync.ts) on the Node runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLogSync } = await import("./server/logSync");
  startLogSync();
}
