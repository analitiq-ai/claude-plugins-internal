# Research: spec folders at any depth

## R1: A spec folder is `<dir>/specs/<feature>/`, read from the path

- **Decision**: a changed path lies in a spec folder when it has a `specs` component followed by a folder
  and a file; the folder is everything up to the component after the first `specs`.
- **Rationale**: it is Spec Kit's own layout (`create-new-feature.sh` writes `<project>/specs/<feature>`),
  so it needs nothing kept in step with it. A `spec_folders` glob list in `config.json` would be a
  hand-maintained list, and `config.json` is plugin-wide, not per repo. None of the seven Analitiq repos
  tracks a nested `*/specs/<x>/` path today, so no folder changes classification; a future non-spec
  `specs/<x>/` folder fails loud (its missing `plan.md` is named), not silently.
- **Existing tools**: `.specify/` marks a Spec Kit project, but only this repo commits it, so a checkout of
  another repo the gate reads does not have it. `design_documents` path patterns in `config.json`: a configured list,
  rejected for the reason above.

## R2: One recogniser for the gate and the design-doc rescope

- **Decision**: `settled_design.spec_folders` serves `branch_problems` and the `--spec-folders` CLI mode,
  measured from `worktree.review_base` like `--branch`; the skill calls the CLI.
- **Rationale**: the skill's `git diff -- specs/ | cut -d/ -f1-2` was a second implementation of the same
  question, and it only saw root `specs/`.
- **Existing tools**: `settled_design.py --branch`, which already runs the gate's measurement by hand:
  extended with a sibling mode.

## R3: design-doc runs Spec Kit from the project directory

- **Decision**: `PROJECT` is the `<dir>` of `#<issue> [<dir>]` (the checkout without one), or for a
  rescope the parent of the folder's `specs`; every `DRIVE` call and grill run from it. `workflow.yml`'s
  `specs/<feature>` check is unchanged, now relative to `PROJECT`.
- **Rationale**: `specify` takes its working directory as the project and requires `.specify/` there
  (`_project.resolve_specify_project_root`; a parent's `.specify/` is refused — run with specify-cli
  1.0.7), and `drive_workflow.py` uses cwd-relative `.specify/` paths, so the run directory alone decides
  where the spec lands. Defaulting to the checkout keeps single-project repos unchanged.
- **Existing tools**: `SPECIFY_INIT_DIR`, Spec Kit's override for the project root: not needed, since the
  working directory already selects it.
