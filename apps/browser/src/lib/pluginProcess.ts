import { isFields } from "./decode";

export const PROCESS_LIMITS = { argv: 32, argBytes: 1024, memoryMB: [64, 4096], access: 16 } as const;

export type AccessGrant = { path: string; write: boolean };
export type ProcessSpec = { run: string[]; memoryMB: number; access: AccessGrant[]; userHome: boolean };

export const PROTECTED_HOME_PATHS: readonly string[] = [
  ".config/ardia",
  "Library/Application Support/com.ardia.browser",
  "Library/Application Support/Ardia",
  "Library/Application Support/Google",
  "Library/Application Support/Chromium",
  "Library/Application Support/Arc",
  "Library/Application Support/Dia",
  "Library/Application Support/Comet",
  "Library/Application Support/BraveSoftware",
  "Library/Application Support/Microsoft Edge",
  "Library/Application Support/Vivaldi",
  "Library/Application Support/com.operasoftware.Opera",
  "Library/Application Support/net.imput.helium",
  "Library/Application Support/Firefox",
  "Library/Application Support/zen",
  "Library/Application Support/Orion",
  "Library/Safari",
  "Library/Containers/com.apple.Safari",
  "Library/Cookies",
  "Library/Keychains",
];

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

export function isPluginPath(value: string): boolean {
  if (!value || value.length > PROCESS_LIMITS.argBytes || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

export function homeGrantProblem(path: string): string | null {
  if (!path.startsWith("~/")) return "must start with ~/ (a folder or file in your home folder)";
  const rest = path.slice(2).replace(/\/+$/, "");
  if (!rest) return "is your whole home folder, which a plugin can't be given";
  if (new TextEncoder().encode(path).length > PROCESS_LIMITS.argBytes || CONTROL.test(path) || rest.includes("\\")) return "must be a plain path of at most 1,024 bytes";
  if (rest.split("/").some((part) => part === "" || part === "." || part === "..")) return "can't have empty, . or .. parts";
  const lower = rest.toLowerCase();
  const clash = PROTECTED_HOME_PATHS.find((p) => inside(lower, p.toLowerCase()) || inside(p.toLowerCase(), lower));
  return clash ? `takes in ~/${clash}, Ardia's own data or another browser's profiles` : null;
}

function accessOf(problems: string[], value: unknown): AccessGrant[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PROCESS_LIMITS.access) {
    problems.push(`process.access must be a list of at most ${PROCESS_LIMITS.access} grants`);
    return [];
  }
  const grants: AccessGrant[] = [];
  value.forEach((entry, i) => {
    const at = `process.access[${i}]`;
    if (!isFields(entry)) return void problems.push(`${at} must be an object like {"path": "~/.tool", "write": true}`);
    for (const key of Object.keys(entry)) if (key !== "path" && key !== "write") problems.push(`${at}.${key} isn't a key of ${at}`);
    if (entry.write !== undefined && typeof entry.write !== "boolean") problems.push(`${at}.write must be true or false`);
    if (typeof entry.path !== "string") return void problems.push(`${at}.path must be a path like ~/.tool`);
    const problem = homeGrantProblem(entry.path);
    if (problem) return void problems.push(`${at}.path ${problem}`);
    const path = entry.path.replace(/\/+$/, "");
    if (grants.some((g) => g.path === path)) return void problems.push(`${at}.path names ${path} twice`);
    grants.push({ path, write: entry.write === true });
  });
  return grants;
}

export function processOf(problems: string[], value: unknown): ProcessSpec | null {
  if (value === undefined) return null;
  if (!isFields(value)) return void problems.push("process must be an object"), null;
  for (const key of Object.keys(value)) if (!["run", "memoryMB", "access", "userHome"].includes(key)) problems.push(`process.${key} isn't a key of process`);
  const run = value.run;
  const okArgs =
    Array.isArray(run) &&
    run.length > 0 &&
    run.length <= PROCESS_LIMITS.argv &&
    run.every((arg) => typeof arg === "string" && arg.length > 0 && new TextEncoder().encode(arg).length <= PROCESS_LIMITS.argBytes && !arg.includes("\0"));
  if (!okArgs) {
    problems.push(`process.run must be a list of 1 to ${PROCESS_LIMITS.argv} arguments, the program first`);
    return null;
  }
  const program = run[0] as string;
  if (!program.startsWith("/") && program.includes("/") && !isPluginPath(program)) problems.push("process.run[0] must be a file in the plugin's folder, an absolute path or a program name");
  const [least, most] = PROCESS_LIMITS.memoryMB;
  let memoryMB = 1024;
  if (value.memoryMB !== undefined) {
    if (typeof value.memoryMB === "number" && Number.isInteger(value.memoryMB) && value.memoryMB >= least && value.memoryMB <= most) memoryMB = value.memoryMB;
    else problems.push(`process.memoryMB must be a whole number from ${least} to ${most}`);
  }
  if (value.userHome !== undefined && typeof value.userHome !== "boolean") problems.push("process.userHome must be true or false");
  return { run: run as string[], memoryMB, access: accessOf(problems, value.access), userHome: value.userHome === true };
}
