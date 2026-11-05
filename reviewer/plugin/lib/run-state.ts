import { tamperId } from "../core/contracts/ledger.ts";
import { GitHubUnanswered, type GitHubClient } from "../core/github.ts";
import type { Shared } from "../core/settings.ts";
import { BoardNotVisible, LedgerMissing, readState, StateStale, StateWriteUnsigned, storyTouched, type StateReading } from "../core/state.ts";
import { CouldNotRun, FIX_THEN_RETRY, RETRY } from "./hook-io.ts";

/** What a run reads its story's state from; `attempts` bounds one step's writes while `ledger` keeps moving. */
export type StateSource = { reader: GitHubClient; repo: string; issue: number; shared: Shared; attempts: number };

// Without the reading or an answer from GitHub, or after a write that may have tampered the story, the step cannot be
// decided.
function undecided(error: unknown): unknown {
  if (error instanceof LedgerMissing) return new CouldNotRun(error.message, "retry the step once it exists", { cause: error });
  if (error instanceof StateWriteUnsigned) {
    return new CouldNotRun(error.message, `the story is held as ${tamperId(error.oid)} until a repository admin clears it`, { cause: error });
  }
  if (error instanceof BoardNotVisible) return new CouldNotRun(error.message, FIX_THEN_RETRY, { cause: error });
  if (error instanceof GitHubUnanswered) return new CouldNotRun(error.message, RETRY, { cause: error });
  return error;
}

async function deciding<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw undecided(error);
  }
}

/**
 * The story's state across one hook run's steps. GitHub's expected-head check is what orders writers, across runs,
 * sessions and machines, so nothing is kept past the run.
 */
export class RunState {
  readonly #source: StateSource;
  #reading: Promise<StateReading> | null = null;

  constructor(source: StateSource) {
    this.#source = source;
  }

  reading(): Promise<StateReading> {
    return (this.#reading ??= this.#read());
  }

  #read(): Promise<StateReading> {
    const { reader, repo, issue, shared } = this.#source;
    return deciding(readState(reader, repo, issue, shared));
  }

  /**
   * Writes what `decide` concludes from the reading. When `ledger` moved, the same write is made again at the new
   * head if no commit since touched the story; otherwise the story is read and decided again.
   */
  async step<D>(decide: (reading: StateReading) => D, write: (reading: StateReading, decision: D) => Promise<StateReading>): Promise<StateReading> {
    const { reader, repo, issue, attempts } = this.#source;
    let reading = await this.reading();
    let decision = decide(reading);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const advanced = await deciding(write(reading, decision));
        this.#reading = Promise.resolve(advanced);
        return advanced;
      } catch (error) {
        if (!(error instanceof StateStale)) throw error;
        if (attempt >= attempts) throw new CouldNotRun("`ledger` kept moving", RETRY, { cause: error });
        if (await deciding(storyTouched(reader, repo, issue, reading.head, error.head))) {
          this.#reading = this.#read();
          reading = await this.#reading;
          decision = decide(reading);
        } else {
          reading = { ...reading, head: error.head };
          this.#reading = Promise.resolve(reading);
        }
      }
    }
  }
}
