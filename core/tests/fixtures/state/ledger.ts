import { createHash } from "node:crypto";

import type { Gates } from "../../../src/contracts/gates.ts";
import { eventFile, eventText, LedgerEvent } from "../../../src/contracts/ledger.ts";
import type { Hold, HoldPlacement, Pushback, Round, RoundId, Ruling, Snapshot } from "../../../src/contracts/snapshot.ts";
import { GitHubRefused } from "../../../src/github.ts";
import type { FakeCall, FakeRoutes } from "../../support/fake-github.ts";
import { ADMIN, at, ISSUE, NOW, placementOf, REPO, SHARED } from "./issue.ts";

export type Signature = { isValid: boolean; wasSignedByGitHub: boolean };

export const GITHUB_SIGNED: Signature = { isValid: true, wasSignedByGitHub: true };
/** An admin's commit signed with their own key: valid, but its date is the author's to set. */
export const OWN_KEY_SIGNED: Signature = { isValid: true, wasSignedByGitHub: false };

export type LedgerCommit = {
  oid: string;
  committedDate: string;
  signature: Signature | null;
  /** REST's `author.login`; null for an author GitHub maps to no account. */
  author: string | null;
  /** The whole tree at this commit, path to text, in the Map's insertion order, not name order. */
  tree: ReadonlyMap<string, string>;
};

export function storyDir(issue = ISSUE): string {
  return `issues/${issue}`;
}

/** Git's own blob id, so a text names one blob wherever it is. */
export function blobOid(text: string): string {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}

type Entry = { name: string; oid: string };

// Listed in the order the fake was given them, not git's name order, so a fold that takes the listing's order for
// the contract's name order is caught.
function entriesOf(tree: ReadonlyMap<string, string>, dir: string): Entry[] {
  const entries = new Map<string, Entry | Map<string, string>>();
  for (const [path, text] of tree) {
    if (!path.startsWith(`${dir}/`)) continue;
    const rest = path.slice(dir.length + 1);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      entries.set(rest, { name: rest, oid: blobOid(text) });
    } else {
      const name = rest.slice(0, slash);
      const files = entries.get(name);
      const subtree = files instanceof Map ? files : new Map<string, string>();
      entries.set(name, subtree.set(rest.slice(slash + 1), text));
    }
  }
  return [...entries].map(([name, entry]) =>
    entry instanceof Map ? { name, oid: createHash("sha1").update(JSON.stringify([...entry].toSorted())).digest("hex") } : entry,
  );
}

/** GitHub's `file(path:)` answer for a directory: null where it has no entry, as git keeps no empty tree. */
function dirAnswer(tree: ReadonlyMap<string, string> | null, dir: string): unknown {
  const entries = tree === null ? [] : entriesOf(tree, dir);
  return entries.length === 0 ? null : { object: { entries } };
}

function sameEntries(a: ReadonlyMap<string, string> | null, b: ReadonlyMap<string, string>, dir: string): boolean {
  return JSON.stringify(a === null ? [] : entriesOf(a, dir)) === JSON.stringify(entriesOf(b, dir));
}

export type Change = {
  /** Paths from the repository root with their texts; a path already there is changed. */
  put?: Record<string, string>;
  remove?: string[];
  date?: string;
  signature?: Signature | null;
  author?: string | null;
};

// GitHub's message when `expectedHeadOid` is not the branch's head.
function movedMessage(expected: string): string {
  return `POST /graphql: Expected branch to point to "${expected}" but it did not. Pull and try again.`;
}

type Vars = Record<string, unknown>;

function varsOf(call: FakeCall): Vars {
  if (call.kind !== "graphql" && call.kind !== "graphqlPages") throw new Error("not a GraphQL call");
  return call.vars;
}

/**
 * An in-memory `ledger` branch: one line of commits, with the GraphQL and REST routes that answer for it.
 * Its routes read `commits` when a call comes, not when the routes are made.
 */
export class FakeLedger {
  readonly exists: boolean;
  /** Oldest first. */
  readonly commits: LedgerCommit[] = [];
  /** The signature GitHub gives each `createCommitOnBranch` from now on. */
  nextSignature: Signature | null = GITHUB_SIGNED;
  /** GitHub's clock for each `createCommitOnBranch` from now on. */
  clock = NOW;
  /** Thrown by the next `createCommitOnBranch` instead of committing, once. */
  refuseNext: Error | null = null;
  /** Commits REST's list leaves out, as a GitHub answering its two APIs from different states would. */
  restOmits: string[] = [];
  /** Commits per page of the branch's unfiltered history, small so a read across pages is exercised. */
  pageSize = 2;
  /** Per blob oid, GitHub's answer for it in place of its full text: none, a binary's or a truncated one. */
  readonly blobAnswers = new Map<string, unknown>();
  private made = 0;

  constructor(exists: boolean) {
    this.exists = exists;
  }

  get head(): string | null {
    return this.commits.at(-1)?.oid ?? null;
  }

  commit({ put = {}, remove = [], date = NOW, signature = GITHUB_SIGNED, author = SHARED.reviewer_app_login }: Change): string {
    if (!this.exists) throw new Error("the fake has no ledger branch to commit to");
    const tree = new Map(this.commits.at(-1)?.tree ?? []);
    for (const path of remove) {
      if (!tree.delete(path)) throw new Error(`the fake ledger has no ${path} to remove`);
    }
    for (const [path, text] of Object.entries(put)) tree.set(path, text);
    this.made += 1;
    const oid = createHash("sha1").update(`${this.head ?? "root"} ${this.made} ${date}`).digest("hex");
    this.commits.push({ oid, committedDate: date, signature, author, tree });
    return oid;
  }

  /** The commits `head` reaches, newest first. */
  private line(head: unknown): LedgerCommit[] {
    const at = this.commits.findIndex((commit) => commit.oid === head);
    if (at === -1) throw new Error(`the fake ledger has no commit ${String(head)}`);
    return this.commits.slice(0, at + 1).toReversed();
  }

  private parentTree(commit: LedgerCommit): ReadonlyMap<string, string> | null {
    const at = this.commits.indexOf(commit);
    return at === 0 ? null : this.commits[at - 1].tree;
  }

  private touching(head: unknown, dir: string): LedgerCommit[] {
    return this.line(head).filter((commit) => !sameEntries(this.parentTree(commit), commit.tree, dir));
  }

  private blob(oid: unknown): string | null {
    for (const commit of this.commits) {
      for (const text of commit.tree.values()) if (blobOid(text) === oid) return text;
    }
    return null;
  }

  /** The routes of a client that reads `ledger`: the session App's, or the orchestrator App's. */
  readRoutes(): Required<Pick<FakeRoutes, "graphql" | "graphqlPages" | "restPagesMatching">> {
    return {
      graphql: [
        { when: (query) => /\bref\(qualifiedName: "refs\/heads\/ledger"\)/.test(query), answer: () => this.refAnswer() },
        { when: (query) => /\.\.\. on Blob \{/.test(query), answer: (call: FakeCall) => this.blobsAnswer(varsOf(call)) },
        {
          when: (query) => /\bhistory\(first: \d+, after: \$cursor\)/.test(query),
          answer: (call: FakeCall) => this.branchPage(varsOf(call)),
        },
        {
          when: (query) => /\bhistory\(first: 1, path: \$path\)/.test(query),
          answer: (call: FakeCall) => this.touchedAnswer(varsOf(call)),
        },
      ],
      graphqlPages: [
        {
          when: (query) => /\bhistory\(first: \d+, after: \$cursor, path: \$path\)/.test(query),
          answer: (call: FakeCall) => this.pathHistory(varsOf(call)),
        },
      ],
      restPagesMatching: [{ when: (path) => path.startsWith(`/repos/${REPO}/commits?`), answer: (call: FakeCall) => this.restCommits(call) }],
    };
  }

  /** The routes of the reviewer App's client: the one mutation. */
  writeRoutes(): Required<Pick<FakeRoutes, "graphql">> {
    return {
      graphql: [{ when: (query) => /\bcreateCommitOnBranch\(/.test(query), answer: (call: FakeCall) => this.mutation(varsOf(call)) }],
    };
  }

  private refAnswer(): unknown {
    const head = this.exists ? this.head : null;
    return { repository: { ref: head === null ? null : { target: { oid: head } } } };
  }

  private pathHistory(vars: Vars): unknown[] {
    const dir = String(vars.path).replace(/\/$/, "");
    return this.touching(vars.head, dir).map((commit) => {
      const parent = this.parentTree(commit);
      return {
        oid: commit.oid,
        committedDate: commit.committedDate,
        signature: commit.signature,
        file: dirAnswer(commit.tree, dir),
        parents: { nodes: parent === null ? [] : [{ file: dirAnswer(parent, dir) }] },
      };
    });
  }

  private restCommits(call: FakeCall): unknown[] {
    if (call.kind !== "restPages") throw new Error("not a REST list read");
    const query = new URL(call.path, "https://api.github.com").searchParams;
    const dir = (query.get("path") ?? "").replace(/\/$/, "");
    return this.touching(query.get("sha"), dir)
      .filter((commit) => !this.restOmits.includes(commit.oid))
      .map((commit) => ({ sha: commit.oid, author: commit.author === null ? null : { login: commit.author } }));
  }

  private blobsAnswer(vars: Vars): unknown {
    const blobs = Object.entries(vars).filter(([name]) => /^b\d+$/.test(name));
    return {
      repository: Object.fromEntries(
        blobs.map(([alias, oid]) => {
          if (this.blobAnswers.has(String(oid))) return [alias, this.blobAnswers.get(String(oid))];
          const text = this.blob(oid);
          return [alias, text === null ? null : { text, isTruncated: false, isBinary: false }];
        }),
      ),
    };
  }

  private branchPage(vars: Vars): unknown {
    const line = this.line(vars.head);
    const from = vars.cursor === null || vars.cursor === undefined ? 0 : Number(vars.cursor);
    const nodes = line.slice(from, from + this.pageSize).map(({ oid, committedDate, signature }) => ({ oid, committedDate, signature }));
    const next = from + this.pageSize;
    const pageInfo = { hasNextPage: next < line.length, endCursor: next < line.length ? String(next) : null };
    return { repository: { object: { history: { nodes, pageInfo } } } };
  }

  private touchedAnswer(vars: Vars): unknown {
    const dir = String(vars.path).replace(/\/$/, "");
    const newest = (oid: unknown) => ({ history: { nodes: this.touching(oid, dir).slice(0, 1).map(({ oid: each }) => ({ oid: each })) } });
    return { repository: { from: newest(vars.from), to: newest(vars.to) } };
  }

  private mutation(vars: Vars): unknown {
    const input = vars.input as {
      branch: { repositoryNameWithOwner: string; branchName: string };
      expectedHeadOid: string;
      message: { headline: string };
      fileChanges: { additions?: { path: string; contents: string }[]; deletions?: { path: string }[] };
    };
    if (this.refuseNext !== null) {
      const refusal = this.refuseNext;
      this.refuseNext = null;
      throw refusal;
    }
    if (!this.exists) throw new GitHubRefused(200, 'POST /graphql: A ref named "ledger" does not exist.');
    if (input.branch.repositoryNameWithOwner !== REPO || input.branch.branchName !== "ledger") {
      throw new Error(`the fake ledger is ${REPO}'s ledger, not ${JSON.stringify(input.branch)}`);
    }
    if (input.expectedHeadOid !== this.head) throw new GitHubRefused(200, movedMessage(input.expectedHeadOid));
    const put = Object.fromEntries(
      (input.fileChanges.additions ?? []).map(({ path, contents }) => [path, Buffer.from(contents, "base64").toString("utf8")]),
    );
    const remove = (input.fileChanges.deletions ?? []).map(({ path }) => path);
    const oid = this.commit({ put, remove, date: this.clock, signature: this.nextSignature });
    return { createCommitOnBranch: { commit: { oid, committedDate: this.clock, signature: this.nextSignature } } };
  }
}

export function fakeLedger({ exists = true }: { exists?: boolean } = {}): FakeLedger {
  return new FakeLedger(exists);
}

type StoryOptions = { issue?: number; date?: string };

function storyPaths(files: Record<string, string>, issue: number): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([name, text]) => [`${storyDir(issue)}/${name}`, text]));
}

/** The event's file name, as the fold expects it. */
export function fileOf(each: LedgerEvent): string {
  return eventFile(LedgerEvent.parse(each));
}

/** The reviewer App's GitHub-signed commit of `events`, each in the file its contract names. */
export function eventCommit(ledger: FakeLedger, events: readonly LedgerEvent[], { issue = ISSUE, date }: StoryOptions = {}): string {
  const files = Object.fromEntries(events.map((each) => [fileOf(each), eventText(each)]));
  return ledger.commit({ put: storyPaths(files, issue), date });
}

/** The reviewer App's GitHub-signed commit of `files` as named, for a name or a text the contract does not give. */
export function reviewerCommit(ledger: FakeLedger, files: Record<string, string>, { issue = ISSUE, date }: StoryOptions = {}): string {
  return ledger.commit({ put: storyPaths(files, issue), date });
}

/** A GitHub-signed deletion of `names` from the story's directory, an admin's by default, as the web UI makes it. */
export function clearanceCommit(
  ledger: FakeLedger,
  names: readonly string[],
  { issue = ISSUE, date, author = ADMIN.login, signature = GITHUB_SIGNED }: StoryOptions & { author?: string; signature?: Signature } = {},
): string {
  return ledger.commit({ remove: names.map((name) => `${storyDir(issue)}/${name}`), date, author, signature });
}

export type Tampering = StoryOptions & {
  /** Story file names with texts, added or changed. */
  put?: Record<string, string>;
  remove?: string[];
  signature?: Signature | null;
  author?: string | null;
};

/** A commit the fold takes as invalid: unsigned and an admin's unless its options say otherwise. */
export function invalidCommit(ledger: FakeLedger, { issue = ISSUE, put = {}, remove = [], date, signature = null, author = ADMIN.login }: Tampering): string {
  return ledger.commit({
    put: storyPaths(put, issue),
    remove: remove.map((name) => `${storyDir(issue)}/${name}`),
    date,
    signature,
    author,
  });
}

export const event = {
  round: (round: Round): LedgerEvent => ({ kind: "round", v: 1, round }),
  ruling: (ruling: Ruling): LedgerEvent => ({ kind: "ruling", v: 1, ruling: { ...ruling, commits: [] } }),
  rulingCommit: (round: RoundId, key: string, commit: string): LedgerEvent => ({ kind: "ruling-commit", v: 1, round, key, commit }),
  pushback: (pushback: Pushback): LedgerEvent => ({ kind: "pushback", v: 1, pushback }),
  hold: (hold: HoldPlacement): LedgerEvent => ({ kind: "hold", v: 1, hold }),
  release: (id: string, since: string | null, released: string, comment: number, reset = false): LedgerEvent => ({
    kind: "release",
    v: 1,
    release: { id, since, released, released_by: { comment, reset } },
  }),
  gates: (ref: string, gates: Gates): LedgerEvent => ({ kind: "gates", v: 1, ref, gates }),
};

/** Per row, a hold event commit dated at its `since`, then for a released row a release event commit dated at its `released`. */
export function placeHolds(ledger: FakeLedger, rows: readonly Hold[]): void {
  for (const row of rows) {
    eventCommit(ledger, [event.hold(placementOf(row))], { date: row.since });
    if (row.released !== null && row.released_by !== null) {
      const { comment, reset } = row.released_by;
      eventCommit(ledger, [event.release(row.id, row.since, row.released, comment, reset)], { date: row.released });
    }
  }
}

/**
 * Commits `state` as the reviewer App would have written it: its rounds, rulings, pushbacks and gates in one commit
 * dated `first`, each FIX's commits in one commit apiece in their order, then `placeHolds` of its rows.
 */
export function storyOf(ledger: FakeLedger, state: Snapshot, { first = at("07:00") }: { first?: string } = {}): void {
  const events = [
    ...state.rounds.map((each) => event.round(each)),
    ...state.rulings.map((each) => event.ruling(each)),
    ...state.pushbacks.map((each) => event.pushback(each)),
    ...(state.gates === null ? [] : [event.gates("check-0", state.gates)]),
  ];
  if (events.length > 0) eventCommit(ledger, events, { date: first });
  for (const { round, key, commits } of state.rulings) {
    for (const commit of commits) eventCommit(ledger, [event.rulingCommit(round, key, commit)], { date: first });
  }
  placeHolds(ledger, state.holds);
}
