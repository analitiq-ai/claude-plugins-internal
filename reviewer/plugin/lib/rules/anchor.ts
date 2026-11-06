import type { Gates } from "../../core/contracts/gates.ts";
import { isAfter, newest } from "./time.ts";

/** The gates' anchor is in none of the hooks' bare copy, the model's clone and GitHub, and no reset lets the check start over. */
export class AnchorMissing extends Error {
  readonly branch: string;
  readonly anchor: string;

  constructor(branch: string, anchor: string, options?: ErrorOptions) {
    super(
      `the gates anchor ${anchor} of branch ${branch} is in none of the hooks' bare copy, the model's clone and GitHub, ` +
        "so nothing was graded; after an admin's `/codeworks reset` on the story issue, the next check starts the branch's " +
        "lineages and bugs over",
      options,
    );
    this.name = "AnchorMissing";
    this.branch = branch;
    this.anchor = anchor;
  }
}

function timesOf(gates: Gates): string[] {
  return [
    ...gates.lineages.flatMap(({ chain }) => chain.map(({ at }) => at)),
    ...gates.bugs.flatMap(({ members, absorbed }) => [...members, ...absorbed].map(({ at }) => at)),
  ];
}

/**
 * The section a check whose anchor is nowhere goes on with: none of its items, anchored on `head`, once the newest
 * reset is later than every time in it (contracts/gates-snapshot.md §Anchor); before that, AnchorMissing, `why` the
 * model's clone did not give the anchor.
 */
export function sectionWithoutAnchor(gates: Gates, head: string, reset: string | null, why: Error): Gates {
  if (reset !== null && isAfter(reset, newest(timesOf(gates)))) return { branch: gates.branch, anchor: head, lineages: [], bugs: [] };
  throw new AnchorMissing(gates.branch, gates.anchor, { cause: why });
}
