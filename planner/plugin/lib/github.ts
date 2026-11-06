import { z } from "zod";

import { needsMint, readGhToken, writeGhToken } from "../core/gh-config.ts";
import { runGit } from "../core/git.ts";
import { answerOf, repositoryOfRemote, type GitHubClient, type Repository } from "../core/github.ts";
import { mintToken, type MintedToken } from "../core/tokens.ts";
import { ghFolder, type CheckoutSettings } from "./settings.ts";
import { SubIssue } from "./story-plan.ts";

/** The checkout has no `origin`, so it names no repository for planner to act on. */
export class NoOrigin extends Error {
  constructor(checkout: string) {
    super(`${checkout} has no remote origin, so it names no GitHub repository for planner`);
    this.name = "NoOrigin";
  }
}

/** The GitHub repository the checkout's origin names; every script acts on this one. */
export async function originRepository(checkout: string): Promise<Repository> {
  // git exits 2 for a remote the checkout does not have.
  const { code, stdout } = await runGit(checkout, ["remote", "get-url", "origin"], [2]);
  if (code === 2) throw new NoOrigin(checkout);
  return repositoryOfRemote(stdout.trim());
}

export type Mint = (appId: number, repo: string) => Promise<MintedToken>;

export const mintPlannerToken: Mint = (appId, repo) => mintToken("planner", appId, "planner-app.pem", "planner", repo);

/** Planner's token for `repo`, minted into its gh folder first when the stored one will not do. */
export async function plannerToken(repo: Repository, settings: CheckoutSettings, now: Date, mint: Mint): Promise<string> {
  const folder = ghFolder(repo);
  const name = `${repo.owner}/${repo.name}`;
  const stored = readGhToken(folder);
  if (stored !== null && !needsMint(stored, name, now)) return stored.value;
  const minted = await mint(settings.planner.app_id, name);
  writeGhToken(folder, minted, settings.shared.planner_app_login);
  return minted.value;
}

/** A client acting as the planner App for `repo`. */
export async function plannerGitHub(
  repo: Repository,
  settings: CheckoutSettings,
  connect: (token: string) => GitHubClient,
  now: Date,
  mint: Mint,
): Promise<GitHubClient> {
  return connect(await plannerToken(repo, settings, now, mint));
}

/** `repo`'s REST path. */
export function repositoryPath(repo: Repository): string {
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

// `url` is what each of the repository's issues gives as its `repository_url`.
const RepositoryAnswer = z.object({ url: z.string(), default_branch: z.string().min(1) });

/** `repo`'s API url and default branch, as GitHub answers them. */
export async function readRepository(github: GitHubClient, repo: Repository): Promise<z.output<typeof RepositoryAnswer>> {
  return answerOf(RepositoryAnswer, await github.rest("GET", repositoryPath(repo)), `${repo.owner}/${repo.name}`);
}

/** The sub-issues of `repo`'s issue `issue`, in GitHub's order. */
export async function readSubIssues(github: GitHubClient, repo: Repository, issue: number): Promise<SubIssue[]> {
  const answer = await github.restPages(`${repositoryPath(repo)}/issues/${issue}/sub_issues`);
  return answerOf(z.array(SubIssue), answer, `the sub-issues of ${repo.owner}/${repo.name}#${issue}`);
}
