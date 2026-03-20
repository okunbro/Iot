const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = process.cwd();

const SKIP_DIR_NAMES = new Set([
  ".git",
  ".github",
  "node_modules",
  "backups",
  "__pycache__",
  ".venv",
]);

const SKIP_RELATIVE_PREFIXES = [
  "grafana/data",
  "influxdb/data",
  "mosquitto/data",
  "mosquitto/log",
  "openhab/userdata/cache",
  "openhab/userdata/logs",
  "openhab/userdata/tmp",
  "openhab/userdata/persistence",
  "openhab/userdata/secrets",
];

const SCAN_EXTENSIONS = new Set([
  ".env",
  ".example",
  ".yml",
  ".yaml",
  ".json",
  ".cfg",
  ".properties",
  ".js",
  ".ps1",
  ".things",
  ".items",
  ".rules",
  ".sitemap",
  ".persist",
  ".txt",
]);

const SAFE_VALUES = new Set([
  "changeme",
  "change_me",
  "your_local_user",
  "your_local_password",
  "your_local_token",
  "replace_in_local_env",
  "example",
  "example_value",
  "placeholder",
  "student",
  "openhab",
  "europe/bratislava",
]);

const SECRET_RE =
  /\b(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key)\b\s*[:=]\s*["']?([^"'\s#]+)/i;

function walkFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(ROOT, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (SKIP_RELATIVE_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
        continue;
      }
      walkFiles(fullPath, results);
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

function shouldScan(filePath) {
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (name === ".env") return true;
  if (name.endsWith(".env.example")) return true;
  return SCAN_EXTENSIONS.has(ext);
}

function isSafeValue(value) {
  const normalized = value.trim().replace(/^["']|["']$/g, "").toLowerCase();

  if (SAFE_VALUES.has(normalized)) return true;
  if (normalized.startsWith("${") && normalized.endsWith("}")) return true;
  if (normalized.startsWith("<") && normalized.endsWith(">")) return true;

  return false;
}

function isTrackedByGit(relativePath) {
  try {
    const output = execSync(`git ls-files -- "${relativePath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    return output.length > 0;
  } catch {
    return false;
  }
}

function main() {
  const errors = [];
  const files = walkFiles(ROOT).filter(shouldScan);

  for (const file of files) {
    const relative = path.relative(ROOT, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8");

    if (path.basename(file) === ".env" && isTrackedByGit(relative)) {
      errors.push(
        `${relative}: tracked .env file detected. Keep .env local only and commit .env.example instead.`
      );
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(SECRET_RE);
      if (!match) return;

      const value = match[2];
      if (isSafeValue(value)) return;

      if (relative === ".env" && !isTrackedByGit(relative)) return;

      errors.push(`${relative}:${index + 1} -> potential secret detected`);
    });
  }

  if (errors.length) {
    console.log("SECRET SCAN FAILED");
    errors.forEach((error) => console.log(`- ${error}`));
    process.exit(1);
  }

  console.log("SECRET SCAN PASSED");
}

main();