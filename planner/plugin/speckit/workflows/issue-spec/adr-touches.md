# List the plan's paths

Your prompt names a spec folder and a run folder. Read `<spec folder>/plan.md` and write
`<run folder>/touches.json`, listing every file the plan says is created, changed or deleted:

```json
{"v": 1, "paths": ["core/src/x.ts", "README.md"]}
```

- One literal path per file created, changed or deleted, relative to the repository root, each file once.
- No glob, no brace group, no trailing `/`, no `..` or `.` segment, no absolute path. A folder the plan changes is
  each file in it the plan names, never the folder.
- Only files the plan itself names. A file you think it should change is not one it names.

Write no other file, and change no file of the spec folder: the check that reads `touches.json` stops when
`plan.md` or `spec.md` changed under it.
