// Runs a workflow script with stand-in agents: argv[2] is the script, stdin is {args, answers}. `answers` maps an
// agent type to the answer every agent of that type gives; a reader's answer is keyed by hunk file, and a claim
// judge's is completed with the claim its schema pins. A nested workflow answers as `answers[name]`. Prints
// {result, calls}.
import { readFileSync } from 'node:fs'

const [script] = process.argv.slice(2)
const { args, answers } = JSON.parse(readFileSync(0, 'utf8'))
const source = readFileSync(script, 'utf8').replace(/^export const meta = [\s\S]*?\n}\n/, '')
const calls = []
const agent = async (prompt, opts) => {
  calls.push({ prompt, ...opts })
  const answer = answers[opts.agentType]
  if (answer === undefined || answer === null) return null
  if (opts.agentType === args.reader_type) {
    const batch = args.readers.find(r => r.schema === opts.schema)
    return { check_ref: args.check_ref, batch: batch.batch, hunks: batch.hunks.map(h => ({ id: h.id, ...answer[h.file] })) }
  }
  if (!opts.schema.properties.quote) return { check_ref: args.check_ref, ...answer }
  return { check_ref: args.check_ref, file: opts.schema.properties.file.enum[0], quote: opts.schema.properties.quote.enum[0], ...answer }
}
const workflow = async (name, wargs) => {
  calls.push({ workflow: name, args: wargs })
  return answers[name] ?? null
}
const parallel = thunks => Promise.all(thunks.map(t => t().catch(() => null)))
const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
  let value = item
  for (const stage of stages) {
    try { value = await stage(value, item, i) } catch { return null }
  }
  return value
}))
const run = new (Object.getPrototypeOf(async function () {}).constructor)('args', 'agent', 'parallel', 'pipeline', 'workflow', source)
console.log(JSON.stringify({ result: await run(args, agent, parallel, pipeline, workflow), calls }))
