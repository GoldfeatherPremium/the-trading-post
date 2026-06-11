import { seedIfEmpty } from "./seed.server";
import { sweepLifecycle } from "./lifecycle.server";

let booted = false;

/** Called at the top of every server function: first-boot seed + lazy lifecycle sweep. */
export function appContext(): void {
  if (!booted) {
    seedIfEmpty();
    booted = true;
  }
  sweepLifecycle();
}
