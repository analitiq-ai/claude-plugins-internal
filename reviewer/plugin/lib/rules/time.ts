import { secondOf } from "../../core/state.ts";

/** Whether `time` is later than `floor`, to GitHub's whole second; every time is after no floor. */
export function isAfter(time: string, floor: string | null): boolean {
  return floor === null || secondOf(time) > secondOf(floor);
}

/** The newest of `times`, null when there is none. */
export function newest(times: readonly (string | null)[]): string | null {
  return times.reduce<string | null>((found, time) => (time === null || !isAfter(time, found) ? found : time), null);
}
