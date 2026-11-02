import { z } from "zod";

// Whole seconds, as GitHub's clock gives them.
export const Time = z.iso.datetime({ precision: 0 });

export const GitSha = z.string().regex(/^[0-9a-f]{40}$/);
