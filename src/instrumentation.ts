export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundServices } = await import("@/lib/indexer/service");
    await startBackgroundServices();
  }
}
