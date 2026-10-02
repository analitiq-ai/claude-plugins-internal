export const meta = {
  name: 'claim-check',
  description: "Check the claims of a staged change before it is committed: read every hunk, then judge each claim about this repo's own behaviour against its code",
  whenToUse: "Before `git commit`, when the alq-review gate asks for it. Pass args.worktree = absolute path of the checkout. To contest a WRONG verdict, also pass args.contests = [{claim: '<id>', evidence: '<path:line or https:// URL>'}].",
  phases: [{ title: 'Read' }, { title: 'Judge' }, { title: 'Contest' }],
}

// Hunks, prompts and schemas arrive in args from the alq-review gate hook, which also validates and records every
// answer; this script only orders the work and reports what came back.
if (!args || !args.check_ref) {
  return { status: 'REFUSED', reason: 'The alq-review gate hook did not supply this check. Is the plugin enabled?' }
}

const fill = c => args.judge.prompt.split('{{file}}').join(c.file).split('{{line}}').join(String(c.line)).split('{{claim}}').join(c.quote)
// Each judge may answer only for its own claim.
const pinned = c => ({ ...args.judge.schema, properties: { ...args.judge.schema.properties, file: { enum: [c.file] }, quote: { enum: [c.quote] } } })
const judge = c => agent(fill(c), { label: `${c.file}:${c.line}`, phase: 'Judge', schema: pinned(c), agentType: args.judge_type })
  .then(verdict => ({ claim: c, verdict }))

const notJudged = { ...args.not_judged }
const judgedClaims = []
const seen = new Set()
const fresh = c => {
  const key = `${c.file}\u0000${c.quote}`
  if (seen.has(key)) return false
  seen.add(key)
  judgedClaims.push(c)
  return true
}

const fromReaders = await pipeline(args.readers,
  reader => agent(reader.prompt, { label: `read batch ${reader.batch}`, phase: 'Read', schema: reader.schema, agentType: args.reader_type }),
  (read, reader) => {
    if (!read) return { silent: true, judged: [] }
    const files = Object.fromEntries(reader.hunks.map(h => [h.id, h.file]))
    const claims = []
    for (const hunk of read.hunks) {
      for (const c of hunk.claims) {
        if (c.category !== 'K1') { notJudged[c.category] = (notJudged[c.category] || 0) + 1; continue }
        const claim = { file: files[hunk.id], line: c.line, quote: c.quote }
        if (fresh(claim)) claims.push(claim)
      }
    }
    return parallel(claims.map(c => () => judge(c))).then(judged => ({ silent: false, judged }))
  })
const known = await parallel(args.claims.filter(fresh).map(c => () => judge(c)))
const contested = await parallel(args.contests.map(c => () =>
  agent(c.prompt, { label: `contest ${c.claim_id}`, phase: 'Contest', schema: c.schema, agentType: args.contest_type })
    .then(verdict => ({ claim_id: c.claim_id, verdict }))))

const silentReaders = args.readers.filter((_, i) => !fromReaders[i] || fromReaders[i].silent).map(r => `reader of batch ${r.batch}`)
const judged = [...fromReaders.filter(Boolean).flatMap(r => r.judged), ...known].filter(Boolean)
const silent = [...silentReaders,
  ...judged.filter(j => !j.verdict).map(j => `judge of ${j.claim.file}:${j.claim.line}`),
  ...args.contests.filter((_, i) => !contested[i] || !contested[i].verdict).map(c => `contest judge of ${c.claim_id}`)]
const agents = args.readers.length + judgedClaims.length + args.contests.length
const report = { check_ref: args.check_ref, judged: judged.filter(j => j.verdict).length, agents, not_judged_categories: notJudged }
if (judgedClaims.length > args.warn_over) {
  report.warning = `${judgedClaims.length} claims were judged; consider splitting the change into several PRs`
}
if (silent.length) {
  return { status: 'INCOMPLETE', ...report, did_not_report: silent, next_step: 'The check is not complete, so the commit stays refused. Launch alq-review:claim-check again with the same args; what was already read and judged is kept.' }
}

const wrong = judged.filter(j => j.verdict.verdict === 'WRONG').map(j => ({
  file: j.claim.file, line: j.claim.line, claim: j.claim.quote, failing_case: j.verdict.failing_case,
  evidence: j.verdict.assertions.filter(a => !a.confirmed).map(a => a.evidence),
}))
const unsure = judged.filter(j => j.verdict.verdict === 'UNSURE').map(j => ({ file: j.claim.file, line: j.claim.line, claim: j.claim.quote, gap: j.verdict.gap }))
const contests = contested.map(c => ({ claim_id: c.claim_id, outcome: c.verdict.verdict === 'WRONG' ? 'rejected' : 'upheld', basis: c.verdict.basis }))
// Whether the commit may land is the gate's to say: it also weighs verdicts settled before this run and the user's releases.
return {
  status: 'COMPLETE', ...report, wrong, unsure, contests,
  next_step: 'Run `git commit` alone. The gate lets it through, or names every WRONG claim with its id; fix each one (or the code it describes), stage it and launch the check again, or contest a verdict with evidence. UNSURE claims are notes for you.',
}
