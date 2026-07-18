const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");

// No dotenv dependency -- this project runs on Node built-ins only (see
// README's "no npm installation required"). Populates process.env from a
// simple KEY=value file without overriding variables the shell already set.
function loadEnvFile(envPath = path.join(__dirname, "..", ".env")) {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadEnvFile };
