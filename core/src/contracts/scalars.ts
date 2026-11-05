import { z } from "zod";

import { ownerAndName } from "../github.ts";

// Whole seconds, as GitHub's clock gives them.
export const Time = z.iso.datetime({ precision: 0 });

export const GitSha = z.string().regex(/^[0-9a-f]{40}$/);

// A part of a ledger file's name, which is `<kind>.<part>….json`: with no separator, the file stays in its story's
// directory.
export const NameSegment = z.string().regex(/^[A-Za-z0-9._-]+$/);

// `owner/name`, as ownerAndName reads it.
export const Repo = z.string().superRefine((repo, ctx) => {
  try {
    ownerAndName(repo);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    ctx.addIssue({ code: "custom", message: error.message });
  }
});
