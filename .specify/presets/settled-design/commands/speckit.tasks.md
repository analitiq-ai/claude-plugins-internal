---
description: Generate an actionable, dependency-ordered tasks.md for the feature based on available design artifacts.
strategy: append
---

## File paths in task lines

> **This section adds to the task format above.**

Name each file a task creates, changes or deletes as one literal path relative to the repository root,
in its own backtick span: `` `core/src/x.ts` ``, never `` `core/src/{x,y}.ts` `` or `` `core/src/*.ts` ``.
No glob, no brace group, no folder standing for its files.
