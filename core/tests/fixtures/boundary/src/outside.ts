import {x} from "../../reviewer/x.ts";
import type {Verdict} from "../../reviewer/types.ts";
export {rule} from "../../orchestrator/rule.ts";
import "not-a-dependency";
const late = await import("../../builder/late.ts");
const required = require("../../planner/required.ts");
export const all: Verdict[] = [x, late, required];
