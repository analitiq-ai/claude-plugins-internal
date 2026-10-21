export const meta = {
  name: 'assess-round',
  description: 'Independent assessment of one completed review round: a verdict per finding and one verdict for the round',
  whenToUse: 'After the PR review poller reports findings, or when the gate says a round is awaiting assessment. Pass args.worktree = absolute path of the checkout. Fix nothing before it returns.',
  phases: [{ title: 'Assess' }],
}

if (!args || !args.assess) {
  return { status: 'REFUSED', reason: 'The reviewer gate hook did not supply this round. Is the plugin enabled?' }
}

// The ids are this round's and nothing else: the assessor can neither skip a finding nor rule on one that is not there.
const schema = args.assess.schema
schema.properties.findings.minItems = args.findings.length
schema.properties.findings.maxItems = args.findings.length
schema.properties.findings.items.properties.id.enum = args.findings.map(f => f.id)

const assessment = await agent(
  `${args.assess.prompt}\n\nFindings of this round:\n${JSON.stringify(args.findings, null, 1)}`,
  { label: 'assessor', phase: 'Assess', schema, agentType: 'reviewer:assessor' },
)
if (!assessment) {
  return { status: 'INCOMPLETE', next_step: 'The assessor did not report. Launch reviewer:assess-round again.' }
}
return { status: 'ASSESSED', round_verdict: assessment.round_verdict, next_step: assessment.next_step, user_decision: assessment.user_decision, assessment, findings: args.findings, spec_folder: args.spec_folder }
