# Probe: Codex's status card on a pull request

This file exists so that a pull request can be opened and driven through Codex's review triggers while
the comment Codex posts and edits (`<!-- codex-pull-request-review-summary -->`) is sampled every few
seconds. The samples become the fixtures for the poller's tests (issue #101). The pull request is closed
without merging once the samples are taken.

Triggers driven, in order: draft marked ready; `@codex review`; a push while that review runs;
`@codex security review`; the PR closed while a review runs.
