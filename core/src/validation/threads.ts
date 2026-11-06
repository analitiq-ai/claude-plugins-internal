import { z } from "zod";

import type { Finding, TrustedComment } from "../contracts/finding.ts";
import { Actor, answerOf, assertIssueNumber, ownerAndName, restLogin, type GitHubClient } from "../github.ts";
import { couldNotRunIfUnread, type CouldNotRun } from "../outcomes.ts";
import { SettingsError, SHARED_SECTION, type Shared } from "../settings.ts";
import { CoreSource } from "../values.ts";

// A deleted account's comment has no author.
const CommentNode = z.object({ id: z.string(), author: Actor.nullable(), body: z.string(), url: z.string() });

// A thread with no comment has no starter to judge it by, so it is refused rather than read as anyone's.
const Comments = z.array(CommentNode).min(1);

const ThreadNode = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  path: z.string(),
  line: z.int().min(1).nullable(),
  comments: z.object({ nodes: Comments, pageInfo: z.object({ hasNextPage: z.boolean() }) }),
});

const COMMENT_FIELDS = "id author { __typename login } body url";

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        nodes {
          id isResolved path line
          comments(first: 100) {
            nodes { ${COMMENT_FIELDS} }
            pageInfo { hasNextPage }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const THREAD_COMMENTS_QUERY = `query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $cursor) {
        nodes { ${COMMENT_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

/** `author` in REST form, null for a deleted account. */
export type ThreadComment = { id: string; author: string | null; body: string };

/** An unresolved review thread: `author` and `url` are its first comment's; `comments` oldest first, never empty. */
export type ReviewThread = {
  id: string;
  author: string | null;
  url: string;
  path: string;
  line: number | null;
  comments: ThreadComment[];
};

/** A thread neither a trusted reviewer nor an enabled module's provider started, for the orchestrator to close. */
export type UntrustedThread = { thread_id: string; url: string; author: string | null };

/** The loaded validators' provider logins, REST form; `Validators` from `loadValidators` is one. */
export type ProviderLogins = { logins: ReadonlySet<string> };

export type ThreadsModule = {
  findings(repo: string, pr: number, head: string): Promise<Finding[] | CouldNotRun>;
  untrusted(repo: string, pr: number): Promise<UntrustedThread[]>;
};

function commentOf(node: z.infer<typeof CommentNode>): ThreadComment {
  return { id: node.id, author: restLogin(node.author), body: node.body };
}

/** The one read of a PR's unresolved review threads, which the threads module and every package's `providerThreads` share. */
export async function reviewThreads(reader: GitHubClient, repo: string, pr: number): Promise<ReviewThread[]> {
  assertIssueNumber(pr);
  const where = { ...ownerAndName(repo), number: pr };
  const pages = await reader.graphqlPages(THREADS_QUERY, where, ["repository", "pullRequest", "reviewThreads"]);
  const nodes = answerOf(z.array(ThreadNode), pages, `the review threads of ${repo}#${pr}`);
  return Promise.all(
    nodes
      .filter((node) => !node.isResolved)
      .map(async (node): Promise<ReviewThread> => {
        // Read to its first page only, a trusted reply past it would not count as new (reviewer ADR-0016 d3).
        // graphqlPages reads one connection from its start, so such a thread's first page is read again.
        const commentNodes = node.comments.pageInfo.hasNextPage
          ? answerOf(
              Comments,
              await reader.graphqlPages(THREAD_COMMENTS_QUERY, { id: node.id }, ["node", "comments"]),
              `the comments of review thread ${node.id} on ${repo}#${pr}`,
            )
          : node.comments.nodes;
        const comments = commentNodes.map(commentOf);
        return { id: node.id, author: comments[0].author, url: commentNodes[0].url, path: node.path, line: node.line, comments };
      }),
  );
}

/** The four codeworks Apps' logins, REST form; none is trusted in any predicate (root ADR-0007 d5). */
export function appLogins(shared: Shared): ReadonlySet<string> {
  return new Set([shared.session_app_login, shared.orchestrator_app_login, shared.reviewer_app_login, shared.planner_app_login]);
}

type Trust = { apps: ReadonlySet<string>; providers: ReadonlySet<string>; reviewers: ReadonlySet<string> };

// One trust for starters and replies alike: enabling a module trusts its provider, and an App is trusted
// whatever `trusted_reviewers` or a package lists.
function trustOf(shared: Shared, validators: ProviderLogins): Trust {
  return { apps: appLogins(shared), providers: validators.logins, reviewers: new Set(shared.trusted_reviewers ?? []) };
}

function isTrusted(trust: Trust, login: string | null): login is string {
  return login !== null && !trust.apps.has(login) && (trust.reviewers.has(login) || trust.providers.has(login));
}

// `author` is the thread's trusted starter. Only trusted comments are carried, so no other text reaches a brief
// (reviewer ADR-0016 d2).
function threadFinding(thread: ReviewThread, author: string, source: string, trust: Trust): Finding {
  const [first, ...replies] = thread.comments;
  const trusted: TrustedComment[] = [{ id: first.id, author, body: first.body }];
  for (const reply of replies) {
    if (isTrusted(trust, reply.author)) trusted.push({ id: reply.id, author: reply.author, body: reply.body });
  }
  return {
    source,
    key: `thread:${thread.id}`,
    author,
    file: thread.path,
    line: thread.line,
    text: first.body,
    thread_id: thread.id,
    resolvable: true,
    trusted_comments: trusted,
    latest_trusted_comment_id: trusted[trusted.length - 1].id,
  };
}

/**
 * A package's provider threads as findings of `source`: those one of `logins`, the package's own, started.
 * `validators.logins` is every loaded package's, `logins` among them, read when called.
 */
export function providerThreadFindings(
  threads: readonly ReviewThread[],
  source: string,
  logins: ReadonlySet<string>,
  shared: Shared,
  validators: ProviderLogins,
): Finding[] {
  const trust = trustOf(shared, validators);
  return threads.flatMap((thread) =>
    isTrusted(trust, thread.author) && logins.has(thread.author) ? [threadFinding(thread, thread.author, source, trust)] : [],
  );
}

/** `validators.logins` is read at each call; a provider's thread is its module's finding alone. */
export function threadsModule(shared: Shared, reader: GitHubClient, validators: ProviderLogins): ThreadsModule {
  // Absent is not empty: read as empty, every reviewer's thread would be closed unread.
  if (shared.trusted_reviewers === undefined) {
    throw new SettingsError(SHARED_SECTION, "trusted_reviewers is absent, so the threads module refuses to run");
  }
  return {
    // A thread is not read at a head; `head` is the findings contract's.
    async findings(repo, pr) {
      let threads: ReviewThread[];
      try {
        threads = await reviewThreads(reader, repo, pr);
      } catch (error) {
        // Findings are a check, so no answer is its outcome.
        return couldNotRunIfUnread(CoreSource.enum.threads, error);
      }
      const trust = trustOf(shared, validators);
      return threads.flatMap((thread) =>
        isTrusted(trust, thread.author) && !trust.providers.has(thread.author)
          ? [threadFinding(thread, thread.author, CoreSource.enum.threads, trust)]
          : [],
      );
    },

    // No check, so it has no outcome to answer with; a no-answer stops its caller.
    async untrusted(repo, pr) {
      const trust = trustOf(shared, validators);
      return (await reviewThreads(reader, repo, pr)).flatMap((thread) =>
        isTrusted(trust, thread.author) ? [] : [{ thread_id: thread.id, url: thread.url, author: thread.author }],
      );
    },
  };
}
