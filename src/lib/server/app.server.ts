import { seedIfEmpty } from "./seed.server";
import { sweepLifecycle } from "./lifecycle.server";

let booted: Promise<void> | null = null;
let lastSweep = 0;
const SWEEP_EVERY_MS = 60_000;

/**
 * Called at the top of every server function. First-boot seed is awaited
 * (one-time). The lifecycle sweep runs at most once per minute and inline
 * within the request scope so it uses the request-scoped DB client (Cloudflare
 * Workers forbid sharing I/O across requests).
 */
export async function appContext(): Promise<void> {
  if (!booted) booted = seedIfEmpty();
  await booted;
  const now = Date.now();
  if (now - lastSweep > SWEEP_EVERY_MS) {
    lastSweep = now;
    try {
      await sweepLifecycle();
    } catch (e) {
      console.error("lifecycle sweep failed:", e);
    }
  }
}
