import { parseBranch } from "../../core/identity.ts";

/** A round's story issue, the issue of the spec it is graded against, and that spec's folder. */
export type SpecSource = { story: number; spec: number; folder: string };

/** How the spec's issue of a story and the folder of a spec's issue are found: core's `specIssue` and `specFolder`. */
export type SpecDerivation = {
  specIssue: (story: number) => Promise<number>;
  specFolder: (spec: number) => Promise<string>;
};

/** The spec source of a round on `branch`, derived afresh at each launch (ADR-0014 d1); a round runs only on a story branch. */
export async function specSource(branch: string, derive: SpecDerivation): Promise<SpecSource | { refused: string }> {
  const parsed = parseBranch(branch);
  if (parsed !== null && "spec" in parsed) {
    return { refused: `\`${branch}\` is a spec branch, and no round runs on one: an admin reviews its spec PR` };
  }
  if (parsed === null) {
    return { refused: `\`${branch}\` is not a story branch, \`<s>-us<k>-<slug>\`, and a round runs only on one: launch it from the story's branch` };
  }
  const spec = await derive.specIssue(parsed.story);
  return { story: parsed.story, spec, folder: await derive.specFolder(spec) };
}
