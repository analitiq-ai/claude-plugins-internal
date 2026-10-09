# Contract: `speclocation.py` changes

Only the additions. The rest is as spec 018 left it.

## Form

```text
<!-- analitiq-spec -->
spec: not worth doing
reason: <one line>
```

Strictly two lines after the marker. `parse` returns `NotWorthDoing(reason)`; any other line count or key is the existing "malformed" refusal.

## Commands

| Command | Effect | Exit |
|---|---|---|
| `not-worth-doing <checkout> <reason>` | upserts the issue's one location comment in this form; prints its URL | 0; 1 on a refusal; 2 on an empty reason or when gh fails |
| `show <issue>` | for this form, prints nothing to stdout and the refusal below to stderr | 1 |
| `status <issue>` | prints exactly one of `located`, `none`, `not worth doing`, `no comment` | 0; 1 with the existing refusal when the comment cannot be read or there is more than one |

## Refusal (from `located`, so also `show` and `resolve`)

`<slug>#<n> was judged not worth doing: <reason>. Next step: run /alq-review:design-doc #<n> to put the question again; its premise step replaces this comment.`

`alq-issue-tackle` and the review gate refuse with this message and no code of their own.
