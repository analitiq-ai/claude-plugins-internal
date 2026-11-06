import type { Hold, Round } from "../../core/contracts/snapshot.ts";
import type { Shared } from "../../core/settings.ts";
import { tamperHold, type StateReading } from "../../core/state.ts";
import { HoldKind, HoldState, Lane, RoundStage } from "../../core/values.ts";
import type { ReviewerSettings } from "../settings.ts";
import { adminFloor, completedSince } from "./rounds.ts";

const { escalation, pushback, audit } = HoldKind.schema.enum;
const { OPEN } = HoldState.schema.enum;
const { AUDIT } = RoundStage.schema.enum;
const { Blocked, Backlog } = Lane.schema.enum;

// The holds that refuse rounds (ADR-0013 d4); claim, shim and rescope holds refuse commits.
const ROUND_HOLDS: readonly Hold["kind"][] = [escalation, pushback, audit];
const UNSTARTED: readonly Lane[] = [Blocked, Backlog];

/** What a round launch asks for, and the session facts it is decided on. */
export type LaunchAsk = { issue: number; stage: Round["stage"]; lane: Lane; off: boolean };

export type LaunchDecision = { stage: Round["stage"] } | { refused: string };

/**
 * Whether a round may launch, and its stage: once the asked stage took `max_rounds` completed rounds since the admin
 * floor, its next round is the audit (ADR-0019 d5).
 */
export function launchDecision(
  reading: StateReading,
  { issue, stage, lane, off }: LaunchAsk,
  shared: Shared,
  settings: Pick<ReviewerSettings, "max_rounds">,
): LaunchDecision {
  const story = `#${issue}`;
  if (off) return { refused: "reviewer is off for this session: type `reviewer on` to run a review round" };
  if (UNSTARTED.includes(lane)) return { refused: `${story} is in ${lane} on ${shared.board}: an admin moves it to Ready before a round runs` };
  const tampered = tamperHold(reading.tamper, shared);
  if (tampered !== null) return { refused: `${tampered.cause}; released by ${tampered.release}` };
  const held = (reading.snapshot?.holds ?? []).filter((row) => row.state === OPEN && ROUND_HOLDS.includes(row.kind));
  if (held.length > 0) {
    const ids = held.map((row) => row.id).join(", ");
    return { refused: `${ids} refuses rounds: an admin's comment and a move of ${story} to Ready on ${shared.board} release it` };
  }
  if (stage === AUDIT) return { stage };
  const completed = completedSince(reading.snapshot?.rounds ?? [], stage, adminFloor(reading));
  return { stage: completed.length >= settings.max_rounds ? AUDIT : stage };
}
