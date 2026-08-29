import type { Logger } from "probot";

import { tickSweep, type SweepSchedulerState } from "../index";

function fakeLogger(): { log: Logger; warns: string[]; errors: unknown[] } {
  const warns: string[] = [];
  const errors: unknown[] = [];
  const log = {
    warn: (message: string) => warns.push(message),
    error: (error: unknown) => errors.push(error),
  } as unknown as Logger;
  return { log, warns, errors };
}

/** A promise plus the functions to settle it, for controlling exactly when a fake sweep "finishes". */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("tickSweep", () => {
  it("runs the sweep and clears the running flag once it settles", async () => {
    const state: SweepSchedulerState = { running: false };
    const { log } = fakeLogger();
    let sweepRan = false;

    await tickSweep(
      state,
      async () => {
        sweepRan = true;
      },
      log,
    );

    expect(sweepRan).toBe(true);
    expect(state.running).toBe(false);
  });

  it("skips a tick that arrives while the previous sweep is still running", async () => {
    const state: SweepSchedulerState = { running: false };
    const { log, warns } = fakeLogger();
    const firstSweep = deferred<void>();
    let secondSweepRan = false;

    // Don't await the first tick yet - it's deliberately left in flight so
    // the second tick below has to observe state.running === true, exactly
    // the overlap this guard exists to prevent.
    const firstTick = tickSweep(state, () => firstSweep.promise, log);

    await tickSweep(
      state,
      async () => {
        secondSweepRan = true;
      },
      log,
    );

    expect(secondSweepRan).toBe(false);
    expect(warns).toEqual(["skipping sweep tick - previous sweep is still running"]);

    firstSweep.resolve();
    await firstTick;
    expect(state.running).toBe(false);
  });

  it("clears the running flag even when the sweep throws, so the next tick isn't skipped forever", async () => {
    const state: SweepSchedulerState = { running: false };
    const { log, errors } = fakeLogger();
    const failure = new Error("GitHub API is down");

    await tickSweep(
      state,
      async () => {
        throw failure;
      },
      log,
    );

    expect(state.running).toBe(false);
    expect(errors).toEqual([failure]);

    let nextSweepRan = false;
    await tickSweep(
      state,
      async () => {
        nextSweepRan = true;
      },
      log,
    );
    expect(nextSweepRan).toBe(true);
  });
});
