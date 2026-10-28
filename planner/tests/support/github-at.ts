// Loaded into the hook under test with `node --import`: core's client sends every call to api.github.com, and a
// hook run as a child process cannot be handed the `api` a test passes to `mintToken` in the same process.
const GITHUB_API = "https://api.github.com";
const local = process.env.PLANNER_TEST_GITHUB_API;
if (local === undefined || local === "") throw new Error("PLANNER_TEST_GITHUB_API names no local GitHub to send calls to");
const realFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (input instanceof Request) throw new Error("the hook under test passed fetch a Request, which this stand-in does not forward");
  const url = new URL(input);
  if (url.origin !== GITHUB_API) throw new Error(`the hook under test fetched ${url.origin}, which is not GitHub's API`);
  return realFetch(`${local}${url.pathname}${url.search}`, init);
};
