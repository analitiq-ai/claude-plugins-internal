export const meta = {
  name: 'shim-check',
  description: 'Check that a staged fix reaches every site that shares its defect, before it is committed',
  whenToUse: "Before `git commit`, when the alq-review gate asks for it. Pass args.worktree = absolute path of the checkout. To contest a listed site, also pass args.contests = [{site: '<id>', reason: '<why>'}].",
  phases: [{ title: 'Sweep' }, { title: 'Judge' }],
}

// The gate hook supplies the agents to run in args and records what they return.
if (!args || !args.check_ref) {
  return { status: 'REFUSED', reason: 'The alq-review gate hook did not supply this check. Is the plugin enabled?' }
}

const runs = [
  ...args.sweepers.map((s, i) => ({ label: `sweeper ${i + 1}`, phase: 'Sweep', ...s })),
  ...args.judges.map(j => ({ label: `judge of site ${j.site}`, phase: 'Judge', ...j })),
]
const answered = await parallel(runs.map(r => () =>
  agent(r.prompt, { label: r.label, phase: r.phase, schema: r.schema, agentType: r.type })))
const silent = runs.filter((_, i) => !answered[i]).map(r => r.label)
if (silent.length) {
  return { status: 'INCOMPLETE', check_ref: args.check_ref, did_not_report: silent,
    next_step: 'The check is not complete, so the commit stays refused. Launch alq-review:shim-check again with the same worktree and no contests.' }
}
return { status: 'COMPLETE', check_ref: args.check_ref, mode: args.mode, agents: runs.length,
  next_step: 'Run `git commit` alone; the gate lets it through or says why not.' }
