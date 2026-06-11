import { seedIfEmpty } from "./seed.server";
import { sweepLifecycle } from "./lifecycle.server";

let booted: Promise<void> | null = null;

/** Called at the top of every server function: first-boot seed + lazy lifecycle sweep. */
export async function appContext(): Promise<void> {
  if (!booted) booted = seedIfEmpty();
  await booted;
  await sweepLifecycle();
}
