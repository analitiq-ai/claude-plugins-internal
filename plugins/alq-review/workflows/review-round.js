export const meta = {
  name: 'review-round',
  description: 'One review round: every reviewer behind a barrier, then one independent assessment of the whole round',
  whenToUse: "The internal PR review (args.stage 'internal', default) or the anti-pattern audit (args.stage 'audit') of a PR branch. Pass args.worktree = absolute path of the checkout and args.spec = '<spec folder>' | null: the PR's spec folder, or null for a change that needs no spec. Never dispatch the reviewer agents directly.",
  phases: [{ title: 'Review' }, { title: 'Assess' }],
}

// Reviewers, prompts and schemas arrive in args from the alq-review gate hook; this script only orders the work.
if (!args || !args.waves) {
  return { status: 'REFUSED', reason: 'The alq-review gate hook did not supply this round. Is the plugin enabled?' }
}

// The gate's decision check result for an internal round; an audit has none, and its result has no such key.
const decided = args.decisions ? { decisions: args.decisions } : {}
const reports = {}
for (const wave of args.waves) {
  const results = await parallel(wave.map(reviewer => () => {
    const evidence = reviewer.needs
      ? `\n\nFindings of ${reviewer.needs} on the same packet:\n${JSON.stringify(reports[reviewer.needs].findings, null, 1)}`
      : ''
    return agent(reviewer.prompt + evidence, { label: reviewer.short, phase: 'Review', schema: reviewer.schema, agentType: reviewer.type })
  }))
  const silent = wave.filter((_, i) => !results[i]).map(reviewer => reviewer.type)
  if (silent.length) {
    return { status: 'INCOMPLETE', round: args.label, did_not_report: silent, next_step: 'Launch this workflow again with the same args; a partial round is not assessed.', ...decided }
  }
  wave.forEach((reviewer, i) => { reports[reviewer.type] = results[i] })
}

const findings = Object.entries(reports).flatMap(([type, report]) => report.findings.map(f => ({ ...f, reviewer: type })))
if (!findings.length) {
  return { status: 'CLEAN', round: args.label, next_step: 'No reviewer found anything that must change. This stage is done.', ...decided }
}
const assessed = await workflow('alq-review:assess-round', { round_ref: args.round_ref, label: args.label, findings, assess: args.assess, spec_folder: args.spec_folder })
return { ...assessed, ...decided }
