---
schemaVersion: 0.2.0
id: "0010"
title: "Name every verdict, ruling and outcome once, as an enum in core's contracts"
status: accepted
date: 2026-10-22
deciders: ["@Analitiq-Bot-Wonka"]
tags: [contracts, verdicts, enums, state-comment, core, reviewer]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0003", "0004", "0009"]
affects:
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "reviewer/plugin/**"
  - type: path
    pattern: "orchestrator/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/145"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:47Z
---

# ADR-0010: Name every verdict, ruling and outcome once, as an enum in core's contracts

## Context

The same outcome goes by different names. The records say RESCOPE where reviewer's code says
RESHAPE_SPEC; reviewer ADR-0021 names a DIRTY round that the code has no name for; a check's outcome is
spread over ADR-0003 and ADR-0004, partly in lower case. Each script that reads a value repeats its
string, and the orchestrator attests from one (orchestrator ADR-0004), so a misspelt value stalls a story.

## Decision

1. We will define each set below, and every other set of values an agent answers in, once, as an
   enum: the sets a component other than reviewer reads in core's contracts (ADR-0003), the rest in
   reviewer's. Code, JSON Schemas and agents' answer schemas take values only from there; a Python
   script reads them from the generated JSON Schemas until it moves to TypeScript (ADR-0009).
2. We will spell every value in upper snake case, except a value also written as a name elsewhere: a
   hold kind, in a hold id, and a finding's source, in `codeworks.toml` and in check names. A validator
   module's name is its folder's in `validators/` (ADR-0003), checked against a grammar, not an enum, so
   adding a module changes no set.
3. We will define each value's meaning beside its enum, and add or rename a value only with the record
   that owns its set.

| Set | Values | Home, owner |
|---|---|---|
| Round result | CLEAN, DIRTY, INCOMPLETE | core; reviewer ADR-0021 |
| Round verdict, of a DIRTY round | PATCH, CLASS_FIX, REDESIGN, RESCOPE, CONVERGED_PUSHBACK, ESCALATE | core; reviewer ADR-0013, ADR-0017, ADR-0018 |
| Finding ruling | FIX, PUSH_BACK, DEFER | core; reviewer ADR-0017 |
| Root cause | AT_CAUSE, AT_SYMPTOM, SPEC_WRONG, CANNOT_TELL, NOT_APPLICABLE | core; reviewer ADR-0017 |
| Check outcome | PENDING, PASS, FAIL, SILENT, COULD_NOT_RUN, WAIVED | core; ADR-0003, ADR-0004 |
| Hold kind | rescope, escalation, pushback, claim, shim, audit, adr | core; reviewer ADR-0013 |
| Hold state | OPEN, RELEASED | core; reviewer ADR-0011, ADR-0013 |
| Round stage | INTERNAL, AUDIT, GITHUB | core; reviewer ADR-0019 |
| Finding source | threads, required-checks, or a validator module's name | core; ADR-0003 |
| Finding kind | DEFECT, FIX_INDUCED, CLASS_SIBLING, DUPLICATE, SPEC_GAP, BIKESHED, GOLD_PLATING, NOT_REAL | reviewer |
| Claim verdict | CORRECT, WRONG, UNSURE | reviewer |
| Shim ruling | SHARES, NOT_SHARED, DEFERRED | reviewer |

## Options considered

### Option A: One enum per set, in the contracts of the component that owns it (chosen)

One spelling, checked where the code compiles.

### Option B: Each script keeps its own constants

Rejected: it is how RESHAPE_SPEC and RESCOPE came to name one verdict.

### Option C: The values listed in records only

Rejected: a record does not stop a misspelt string in code.

## Trade-offs

- Renaming a value is a contract change in every component that reads it.
- Python scripts read values from generated files until they move.

## Consequences

- Easier: one place answers what a value means.
- Harder: an agent's answer schema must be generated, not written by hand.
- **How we would know this was wrong:** a value string written in code outside its enum, or a record
  naming a value its set lacks.
- Revisit if: a set's values must differ between components.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
