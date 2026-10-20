# Specification Quality Checklist: Merge override grants in the state folder

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-07
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Validated 2026-10-07, one pass, against main at `2ec150f` (after PR #37 merged).
- The feature is about where a record is kept, so the state folder, its setting `ALQ_REVIEW_STATE_DIR`, the session id and the `gh pr merge` commands are the user's own vocabulary here. No script, function or file name of the plugin appears in a requirement.
- FR-007, FR-008, SC-006 and SC-007 are about the plugin having one of a thing. They are checked by reading the plugin, which is the only way to observe "written once".
- SC-004 names the existing tests of the override as the measure, as spec 016 SC-003 does.
- Validated again on 2026-10-07 after the critique's changes (a grant asked for only by a merge that needs one; one line shown for a recorded override; FR-016, SC-008): 16 of 16.
- Clarified with the user on 2026-10-07: a session id that is not a plain name refuses (FR-010), and the write guard's gap in `log` mode and in a session that is off is issue #38, not this feature.
- The form of the grant record (FR-012) is left to the plan's data model.
- Validated again on 2026-10-07 after the second critique's changes (an override names its PR; a refusal gives the line in full or says why none applies; FR-017, FR-018, SC-009): 16 of 16.
- `override-merge owner/repo#N`, github.com and "the hook's path" are in requirements because they are what the user types and reads; SC-004 names the existing tests as its measure, as before.
