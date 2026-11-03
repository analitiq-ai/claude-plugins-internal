# The files the plan touches

You are given a spec folder and a run folder. Read `<spec folder>/plan.md` as it stands now and write
`<run folder>/touches.json`, the paths planner's ADR check asks the listed ADR folders about:

```json
{"v": 1, "paths": ["core/src/adr-folders.ts", "codeworks.toml"]}
```

- One literal path per file the plan creates, changes or deletes, relative to the repository root. Each file once.
- A path is ASCII letters, digits, `.`, `_` and `-`, its segments joined by `/`: no glob, no brace group, no
  trailing `/`, no `..` segment and no `.` segment. A folder is not a path: name each file in it the plan touches.
- `v` is `1`; the file has no key but `v` and `paths`.

Write no other file, and change no artifact: `plan.md`, `spec.md` and every other file stay as they are.
