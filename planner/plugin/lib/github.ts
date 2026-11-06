import { needsMint, readGhToken, writeGhToken } from "../core/gh-config.ts";
import type { GitHubClient, Repository } from "../core/github.ts";
import { mintToken, type MintedToken } from "../core/tokens.ts";
import { ghFolder, type CheckoutSettings } from "./settings.ts";

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
