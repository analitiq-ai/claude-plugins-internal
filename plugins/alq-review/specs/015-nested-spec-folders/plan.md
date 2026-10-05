# Plan: spec folders at any depth

`scripts/settled_design.py` gets `spec_folders(root, changed)`: the `<dir>/specs/<feature>` folder of each
changed path, kept when the checkout still has it (R1). `branch_problems` uses it in place of its
`specs/`-prefix test, and a `--spec-folders <checkout> <branch it merges into>` mode prints it (R2). The
design-doc skill finds a rescope's folder with that mode, and runs `drive_workflow.py` and grill from the
folder's project directory; `#<issue> [<dir>]` names the project for a new spec, the checkout by default
(R3). README §6 states the rule. Tests in `tests/test_gate.py`.

## Mechanisms

- A spec folder is `<dir>/specs/<feature>/` at any depth, derived from the path, with no configured list: R1
- One recogniser, shared by the gate and the design-doc rescope: R2
- design-doc runs Spec Kit from the spec's project directory: R3
