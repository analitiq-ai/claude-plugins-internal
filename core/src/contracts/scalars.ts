import { z } from "zod";

// Whole seconds, as GitHub's clock gives them.
export const Time = z.iso.datetime({ precision: 0 });

export const GitSha = z.string().regex(/^[0-9a-f]{40}$/);

// A part of a ledger file's name, which is `<kind>.<part>….json`: with no separator, the file stays in its story's
// directory.
export const NameSegment = z.string().regex(/^[A-Za-z0-9._-]+$/);
