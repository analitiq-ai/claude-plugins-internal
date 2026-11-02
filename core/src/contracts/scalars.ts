import { z } from "zod";

// Whole seconds, as GitHub's clock gives them. Core stamps a round's and a hold row's times from the client's
// `now()`, so no caller's clock reaches them; the gates section's times are recordGates's caller's.
export const Time = z.iso.datetime({ precision: 0 });

export const GitSha = z.string().regex(/^[0-9a-f]{40}$/);
