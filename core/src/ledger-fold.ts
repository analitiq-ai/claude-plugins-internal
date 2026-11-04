import { z } from "zod";

import { EVENT_KIND, eventFile, inApplyOrder, LedgerEvent, tamperId } from "./contracts/ledger.ts";
import { Snapshot, type Hold, type RoundId } from "./contracts/snapshot.ts";
import { isAdminRole } from "./github.ts";
import { FindingRuling, HoldKind, HoldState } from "./values.ts";

export const EMPTY_SNAPSHOT: Snapshot = { v: 1, rounds: [], holds: [], pushbacks: [], rulings: [], gates: null };

/** A file of a story's directory as a commit leaves it; `blob` is git's object id of its text. */
export type StoryFile = { name: string; blob: string };

/** A commit touching a story's directory, as GitHub tells it; each list is in name order. */
export type StoryCommit = {
  oid: string;
  committedDate: string;
  /** `signature.isValid && signature.wasSignedByGitHub`. */
  signed: boolean;
  /** REST's `author.login`; null for an author GitHub maps to no account. */
  author: string | null;
  added: StoryFile[];
  changed: StoryFile[];
  removed: string[];
};

/** The story as its events give it. */
export type Ledgered = {
  snapshot: Snapshot;
  /** Per hold row, the committedDate of the commit that placed its current opening: its release floor. */
  placed: ReadonlyMap<string, string>;
  releasedTampers: ReadonlySet<string>;
};

export type DerivedTamper = {
  id: string;
  commit: StoryCommit;
  /** The names of the files it added or changed. */
  touched: string[];
};

export type StoryFold = Ledgered & {
  /** Oldest first. */
  tampers: DerivedTamper[];
  /** The file each applied event was read from: an event in one of these is already written. */
  eventFiles: ReadonlySet<string>;
  /** The directory's files at the newest commit. */
  headFiles: ReadonlySet<string>;
};

export type Applied = { ok: true; state: Ledgered } | { ok: false; why: string };

function sameRound(a: RoundId, b: RoundId): boolean {
  return a.stage === b.stage && a.n === b.n;
}

function roundName({ stage, n }: RoundId): string {
  return `round ${stage} ${n}`;
}

function hasRound(snapshot: Snapshot, round: RoundId): boolean {
  return snapshot.rounds.some((each) => sameRound(each, round));
}

function withSnapshot(state: Ledgered, snapshot: Snapshot): Ledgered {
  return { ...state, snapshot };
}

// The contract's "applies when" of each kind: a string says why the event does not apply.
function applyEvent(state: Ledgered, event: LedgerEvent, committedDate: string, derived: ReadonlySet<string>): Ledgered | string {
  const { snapshot } = state;
  const { OPEN, RELEASED } = HoldState.schema.enum;
  switch (event.kind) {
    case EVENT_KIND.round: {
      const { round } = event;
      if (snapshot.rounds.some((each) => sameRound(each, round) || each.run === round.run)) {
        return `${roundName(round)} or run ${round.run} is already in rounds`;
      }
      return withSnapshot(state, { ...snapshot, rounds: [...snapshot.rounds, round] });
    }
    case EVENT_KIND.ruling: {
      const { ruling } = event;
      if (!hasRound(snapshot, ruling.round)) return `${roundName(ruling.round)} of the ruling of ${ruling.key} is not in rounds`;
      if (snapshot.rulings.some((each) => sameRound(each.round, ruling.round) && each.key === ruling.key)) {
        return `${ruling.key} is already ruled in ${roundName(ruling.round)}`;
      }
      return withSnapshot(state, { ...snapshot, rulings: [...snapshot.rulings, ruling] });
    }
    case EVENT_KIND["ruling-commit"]: {
      const at = snapshot.rulings.findIndex((each) => sameRound(each.round, event.round) && each.key === event.key);
      if (at === -1) return `${event.key} has no ruling in ${roundName(event.round)}`;
      const ruling = snapshot.rulings[at];
      const fix = FindingRuling.schema.enum.FIX;
      if (ruling.ruling !== fix) return `the ruling of ${event.key} in ${roundName(event.round)} is ${ruling.ruling}, not ${fix}`;
      if (ruling.commits.includes(event.commit)) return `the ruling of ${event.key} already names ${event.commit}`;
      return withSnapshot(state, { ...snapshot, rulings: snapshot.rulings.with(at, { ...ruling, commits: [...ruling.commits, event.commit] }) });
    }
    case EVENT_KIND.pushback: {
      const { pushback } = event;
      if (!hasRound(snapshot, pushback.round)) return `${roundName(pushback.round)} of the pushback of ${pushback.key} is not in rounds`;
      return withSnapshot(state, { ...snapshot, pushbacks: [...snapshot.pushbacks, pushback] });
    }
    case EVENT_KIND.hold: {
      const { hold } = event;
      const at = snapshot.holds.findIndex((row) => row.id === hold.id);
      const row = at === -1 ? undefined : snapshot.holds[at];
      // A spec PR's number keys a rescope row (reviewer ADR-0013 d5).
      const respecified = hold.kind === HoldKind.schema.enum.rescope && hold.spec_pr !== null && row?.spec_pr !== hold.spec_pr;
      if (row?.state === OPEN && !respecified) return `hold ${hold.id} is OPEN`;
      const placed: Hold = { ...hold, state: OPEN, released: null, released_by: null };
      return {
        ...state,
        snapshot: { ...snapshot, holds: row === undefined ? [...snapshot.holds, placed] : snapshot.holds.with(at, placed) },
        placed: new Map(state.placed).set(hold.id, committedDate),
      };
    }
    case EVENT_KIND.release: {
      const { id, since, released, released_by } = event.release;
      // The contract sets `since` on a hold's release and on no tamper's.
      if (since === null) {
        if (!derived.has(id)) return `${id} is no tamper the fold derived`;
        if (state.releasedTampers.has(id)) return `${id} is already released`;
        return { ...state, releasedTampers: new Set(state.releasedTampers).add(id) };
      }
      const at = snapshot.holds.findIndex((row) => row.id === id);
      const row = at === -1 ? undefined : snapshot.holds[at];
      if (row?.state !== OPEN || row.since !== since) return `hold ${id} is not OPEN since ${since}`;
      return withSnapshot(state, { ...snapshot, holds: snapshot.holds.with(at, { ...row, state: RELEASED, released, released_by }) });
    }
    case EVENT_KIND.gates:
      return withSnapshot(state, { ...snapshot, gates: event.gates });
  }
}

/**
 * One commit's `events`, in apply order, applied to `state`: all of them or none. `derived` holds the ids of the
 * tampers derived before the commit.
 */
export function applyEvents(state: Ledgered, events: readonly LedgerEvent[], committedDate: string, derived: ReadonlySet<string>): Applied {
  let next = state;
  for (const event of events) {
    const applied = applyEvent(next, event, committedDate, derived);
    if (typeof applied === "string") return { ok: false, why: applied };
    next = applied;
  }
  const valid = Snapshot.safeParse(next.snapshot);
  if (!valid.success) return { ok: false, why: `the snapshot breaks its contract: ${z.prettifyError(valid.error)}` };
  return { ok: true, state: next };
}

/** Whether `commit` could be an event commit, so the texts of the files it added are read. */
export function mayHoldEvents(commit: StoryCommit, reviewerLogin: string): boolean {
  return commit.signed && commit.author === reviewerLogin && commit.added.length > 0 && commit.changed.length === 0 && commit.removed.length === 0;
}

/** Whether `commit` could be a clearance, so its author's role is read. */
export function mayClear(commit: StoryCommit, reviewerLogin: string): commit is StoryCommit & { author: string } {
  return (
    commit.signed &&
    commit.author !== null &&
    commit.author !== reviewerLogin &&
    commit.added.length === 0 &&
    commit.changed.length === 0 &&
    commit.removed.length > 0
  );
}

function parsedEvent(text: string): LedgerEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  const parsed = LedgerEvent.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function eventsOf(commit: StoryCommit, texts: ReadonlyMap<string, string>, reviewerLogin: string): LedgerEvent[] | null {
  if (!mayHoldEvents(commit, reviewerLogin)) return null;
  const events: LedgerEvent[] = [];
  for (const file of commit.added) {
    const text = texts.get(file.blob);
    const event = text === undefined ? null : parsedEvent(text);
    if (event === null || eventFile(event) !== file.name) return null;
    events.push(event);
  }
  return inApplyOrder(events);
}

type Origin = "event" | "invalid";

function roleOfAuthor(roles: ReadonlyMap<string, string>, login: string): string {
  const role = roles.get(login);
  if (role === undefined) throw new Error(`no role was read for ${login}, the author of a commit that may clear a tamper`);
  return role;
}

function clears(commit: StoryCommit, origins: ReadonlyMap<string, Origin>, roles: ReadonlyMap<string, string>, reviewerLogin: string): boolean {
  return (
    mayClear(commit, reviewerLogin) &&
    isAdminRole(roleOfAuthor(roles, commit.author)) &&
    commit.removed.every((name) => origins.get(name) === "invalid")
  );
}

/**
 * The story's commits, oldest first, folded: each an event commit, a clearance or an invalid commit, as the ledger
 * record contract classes them. `texts` holds the text of every file an event commit could have added; `roles`, the
 * role of every author a clearance could be by.
 */
export function foldStory(
  commits: readonly StoryCommit[],
  texts: ReadonlyMap<string, string>,
  roles: ReadonlyMap<string, string>,
  reviewerLogin: string,
): StoryFold {
  let state: Ledgered = { snapshot: EMPTY_SNAPSHOT, placed: new Map(), releasedTampers: new Set() };
  const tampers: DerivedTamper[] = [];
  const derived = new Set<string>();
  const eventFiles = new Set<string>();
  // Whose text each file in the directory holds: a clearance deletes only an invalid commit's.
  const origins = new Map<string, Origin>();
  for (const commit of commits) {
    const events = eventsOf(commit, texts, reviewerLogin);
    const applied = events === null ? null : applyEvents(state, events, commit.committedDate, derived);
    if (applied?.ok) {
      state = applied.state;
      for (const { name } of commit.added) {
        eventFiles.add(name);
        origins.set(name, "event");
      }
    } else if (clears(commit, origins, roles, reviewerLogin)) {
      for (const name of commit.removed) origins.delete(name);
    } else {
      const touched = [...commit.added, ...commit.changed].map(({ name }) => name);
      const id = tamperId(commit.oid);
      tampers.push({ id, commit, touched });
      derived.add(id);
      for (const name of touched) origins.set(name, "invalid");
      for (const name of commit.removed) origins.delete(name);
    }
  }
  return { ...state, tampers, eventFiles, headFiles: new Set(origins.keys()) };
}
