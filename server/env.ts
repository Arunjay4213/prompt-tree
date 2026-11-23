// Loads .env into process.env before any other server module reads it, so index.ts imports this first.
// Done here instead of with node's --env-file-if-exists, because tsx passes that flag to two node
// processes, and each printed ".env not found" when there is no .env (as in demo mode).
// Values already in the environment win, the same as with --env-file.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

// Demo mode: `--demo` on the command line (works the same in every shell, Windows included),
// or DEMO_MODE=1 in the environment or in .env.
export const DEMO = process.argv.includes("--demo") || process.env.DEMO_MODE === "1";
