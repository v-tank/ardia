import { isFields } from "./decode";

export const FIRST_PARTY_PLUGINS: readonly string[] = ["ai"];
export const COUNTER_PATTERN = "^[a-z][a-z0-9_]{0,39}$";
export const MAX_COUNTERS = 32;
export const MAX_COUNT_STEP = 1000;
const COUNTER = new RegExp(COUNTER_PATTERN);

export type TelemetrySpec = { counters: string[] };

export const isFirstPartyPlugin = (name: string) => FIRST_PARTY_PLUGINS.includes(name);

export function telemetryOf(problems: string[], value: unknown): TelemetrySpec {
  if (value === undefined) return { counters: [] };
  if (!isFields(value)) return problems.push("telemetry must be an object like {\"counters\": [\"chats_started\"]}"), { counters: [] };
  for (const key of Object.keys(value)) if (key !== "counters") problems.push(`telemetry.${key} isn't a key of telemetry`);
  const given = value.counters ?? [];
  if (!Array.isArray(given) || given.length > MAX_COUNTERS) return problems.push(`telemetry.counters must be a list of at most ${MAX_COUNTERS} names`), { counters: [] };
  const counters: string[] = [];
  given.forEach((name, i) => {
    if (typeof name !== "string" || !COUNTER.test(name)) problems.push(`telemetry.counters[${i}] must be a lowercase name like chats_started (a letter, then up to 39 letters, digits and _)`);
    else if (counters.includes(name)) problems.push(`telemetry.counters names ${name} twice`);
    else counters.push(name);
  });
  return { counters };
}
