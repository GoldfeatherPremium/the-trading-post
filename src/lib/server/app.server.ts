import { seedIfEmpty } from "./seed.server";
import { sweepLifecycle } from "./lifecycle.server";

let booted: Promise<void> | null = null;

/**
 * Called at the top of every server function. First-boot seed is awaited
 * (one-time); the lifecycle sweep runs fire-and-forget so it never adds
 * latency to the request that happened to trigger it.
 */
export async function appContext(): Promise<void> {
  if (!booted) booted = seedIfEmpty();
  await booted;
  void sweepLifecycle().catch((e) => console.error("lifecycle sweep failed:", e));
}
