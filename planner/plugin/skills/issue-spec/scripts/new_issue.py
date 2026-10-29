#!/usr/bin/env python3
"""Create the issue of a change that has none, in the repo `origin` names, so the change can be scoped as an issue.

    new_issue.py types
    new_issue.py create <type> <issue file>

`types` prints the repo's issue types, one per line. `create` reads `# <title>`, a blank line and the body from the
issue file, and prints the new issue as JSON: `issue`, `url`.

The repo is named by origin's URL: gh left to pick one picks it from the other remotes. The title and body reach
GitHub on stdin, never as arguments: they are the user's text, and routinely carry backticks.
"""
import json
import subprocess
import sys
from pathlib import Path

# gh as the planner App, so the issue is created by the App and never with the admin's login.
GH = Path(__file__).resolve().parents[3] / "scripts" / "gh.ts"
TYPES_QUERY = ("query($owner: String!, $name: String!) "
               "{ repository(owner: $owner, name: $name) { issueTypes(first: 100) { nodes { name } } } }")


def _gh(args, failed, stdin=None):
    proc = subprocess.run(["node", str(GH), *args], input=stdin, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"{failed}: {proc.stderr.strip()}\nNext step: fix what GitHub says, then run this again.")
    return proc.stdout


def _repo():
    """origin's repo, as `<owner>/<name>`."""
    origin = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True)
    if origin.returncode != 0:
        sys.exit(f"The checkout has no origin remote: {origin.stderr.strip()}\n"
                 "Next step: run this in a checkout whose origin is the repo the issue belongs in.")
    return _gh(["repo", "view", origin.stdout.strip(), "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
               "GitHub could not show origin's repo").strip()


def _types(repo):
    owner, name = repo.split("/")
    names = _gh(["api", "graphql", "-f", f"query={TYPES_QUERY}", "-f", f"owner={owner}", "-f", f"name={name}",
                 "--jq", ".data.repository.issueTypes.nodes[].name"], f"GitHub could not list {repo}'s issue types")
    return names.splitlines()


def _issue(path):
    """(title, body) of the issue file at `path`."""
    first, _, body = Path(path).read_text().partition("\n")
    title = first[2:].strip() if first.startswith("# ") else ""
    if not title or not body.strip():
        sys.exit(f"{path} has no title or no body. Next step: write `# <title>`, a blank line and the body to it.")
    return title, body.strip()


def create(kind, path):
    title, body = _issue(path)
    repo = _repo()
    offered = _types(repo)
    if kind not in offered:
        sys.exit(f"`{kind}` is not an issue type of {repo}, which offers {', '.join(offered) or 'none'}. "
                 "Next step: pick one of them.")
    created = json.loads(_gh(["api", "--method", "POST", f"repos/{repo}/issues", "--input", "-"],
                             f"GitHub did not create the issue in {repo}",
                             stdin=json.dumps({"title": title, "body": body, "type": kind})))
    # GitHub creates the issue and drops its type, without an error, for a user without push access.
    if (created.get("type") or {}).get("name") != kind:
        sys.exit(f"GitHub created {created['html_url']} but did not set its type to `{kind}`. Next step: set the "
                 "type on that issue, or have a user with push access to the repo set it, then scope it as "
                 f"`#{created['number']}`.")
    return {"issue": str(created["number"]), "url": created["html_url"]}


def main():
    args = sys.argv[1:]
    if args == ["types"]:
        print("\n".join(_types(_repo())))
    elif len(args) == 3 and args[0] == "create":
        print(json.dumps(create(args[1], args[2])))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
