import type { GitHubClient } from "../core/github.ts";
import type { Shared } from "../core/settings.ts";
import { readState, StateStale, storyTouched, type StateReading } from "../core/state.ts";
import { CouldNotRun, orCouldNotRun, RETRY } from "./hook-io.ts";

/** What a run reads its story's state from; `attempts` bounds one step's writes while `ledger` keeps moving. */
export type StateSource = { reader: GitHubClient; repo: string; issue: number; shared: Shared; attempts: number };

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

  get source(): StateSource {
    return this.#source;
  }

  reading(): Promise<StateReading> {
    return (this.#reading ??= this.#read());
  }

  #read(): Promise<StateReading> {
    const { reader, repo, issue, shared } = this.#source;
    return orCouldNotRun(readState(reader, repo, issue, shared));
  }

  /**
   * Writes what `decide` concludes from the reading. When `ledger` moved, the same write is made again at the new
   * head if no commit since touched the story; otherwise the story is read and decided again.
   */
  async step<D>(
    decide: (reading: StateReading) => D | Promise<D>,
    write: (reading: StateReading, decision: D) => Promise<StateReading>,
  ): Promise<StateReading> {
    const { reader, repo, issue, attempts } = this.#source;
    // An async wrapper turns a decide that throws as it is called into a rejection orCouldNotRun converts.
    const decided = async (at: StateReading): Promise<D> => decide(at);
    let reading = await this.reading();
    let decision = await orCouldNotRun(decided(reading));
    for (let attempt = 1; ; attempt += 1) {
      try {
        const advanced = await orCouldNotRun(write(reading, decision));
        this.#reading = Promise.resolve(advanced);
        return advanced;
      } catch (error) {
        if (!(error instanceof StateStale)) throw error;
        if (attempt >= attempts) throw new CouldNotRun("`ledger` kept moving", RETRY, { cause: error });
        if (await orCouldNotRun(storyTouched(reader, repo, issue, reading.head, error.head))) {
          this.#reading = this.#read();
          reading = await this.#reading;
          decision = await orCouldNotRun(decided(reading));
        } else {
          reading = { ...reading, head: error.head };
          this.#reading = Promise.resolve(reading);
        }
      }
    }
  }
}
