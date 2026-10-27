import {readFileSync} from "node:fs";
import {all} from "./outside.ts";
import {rule} from "../src/outside.ts";
// import {x} from "../../reviewer/x.ts" is a comment, not an import
export const text = [readFileSync, all, rule, "from ../../reviewer/x.ts"];
