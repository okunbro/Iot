const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = process.cwd();
const CONF_DIR = path.join(ROOT, "openhab", "conf");

const ITEMS_DIR = path.join(CONF_DIR, "items");
const THINGS_DIR = path.join(CONF_DIR, "things");
const RULES_DIR = path.join(CONF_DIR, "rules");
const SITEMAPS_DIR = path.join(CONF_DIR, "sitemaps");
const PERSISTENCE_DIR = path.join(CONF_DIR, "persistence");

const REQUIRED_DIRS = [
  ITEMS_DIR,
  THINGS_DIR,
  RULES_DIR,
  SITEMAPS_DIR,
  PERSISTENCE_DIR,
];

const ITEM_TYPES = new Set([
  "Color",
  "Contact",
  "DateTime",
  "Dimmer",
  "Group",
  "Image",
  "Location",
  "Number",
  "Player",
  "Rollershutter",
  "String",
  "Switch",
]);

const SKIP_DIR_NAMES = new Set([
  ".git",
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

function exists(p) {
  return fs.existsSync(p);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function getFiles(dir, extension) {
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(extension))
    .map((file) => path.join(dir, file))
    .sort();
}

function walkFiles(dir, results = []) {
  if (!exists(dir)) return results;

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

function ensureRequiredDirs() {
  const errors = [];

  for (const dir of REQUIRED_DIRS) {
    if (!exists(dir)) {
      errors.push(`Missing required directory: ${path.relative(ROOT, dir)}`);
    }
  }

  return errors;
}

function ensureRequiredFiles() {
  const errors = [];
  const checks = [
    [ITEMS_DIR, ".items"],
    [THINGS_DIR, ".things"],
    [RULES_DIR, ".rules"],
    [SITEMAPS_DIR, ".sitemap"],
    [PERSISTENCE_DIR, ".persist"],
  ];

  for (const [dir, extension] of checks) {
    if (exists(dir) && getFiles(dir, extension).length === 0) {
      errors.push(`No ${extension} files found in ${path.relative(ROOT, dir)}`);
    }
  }

  return errors;
}

function extractItemNames() {
  const items = new Set();
  const files = getFiles(ITEMS_DIR, ".items");

  for (const file of files) {
    const lines = readText(file).split(/\r?\n/);

    for (const line of lines) {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith("//")) continue;

      const parts = stripped.split(/\s+/);
      if (parts.length < 2) continue;

      const rawType = parts[0];
      const baseType = rawType.split(":")[0];

      if (ITEM_TYPES.has(baseType)) {
        items.add(parts[1]);
      }
    }
  }

  return items;
}

function collectThingsAndChannels() {
  const thingChannels = new Map();
  const files = getFiles(THINGS_DIR, ".things");

  const thingStartRegex = /^\s*Thing\s+[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:([A-Za-z0-9_-]+)/;
  const channelRegex = /^\s*Type\s+[A-Za-z0-9:_-]+\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/;

  for (const file of files) {
    const lines = readText(file).split(/\r?\n/);
    let currentThing = null;
    let braceBalance = 0;

    for (const line of lines) {
      const thingMatch = line.match(thingStartRegex);
      if (thingMatch) {
        currentThing = thingMatch[1];
        if (!thingChannels.has(currentThing)) {
          thingChannels.set(currentThing, new Set());
        }
        braceBalance = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        continue;
      }

      if (currentThing) {
        const channelMatch = line.match(channelRegex);
        if (channelMatch) {
          thingChannels.get(currentThing).add(channelMatch[1]);
        }

        braceBalance += (line.match(/{/g) || []).length;
        braceBalance -= (line.match(/}/g) || []).length;

        if (braceBalance <= 0) {
          currentThing = null;
        }
      }
    }
  }

  return thingChannels;
}

function collectItemLinks() {
  const files = getFiles(ITEMS_DIR, ".items");
  const links = [];
  const channelRegex = /channel="([^"]+)"/;

  for (const file of files) {
    const lines = readText(file).split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = line.trim();

      if (!stripped || stripped.startsWith("//")) continue;

      const parts = stripped.split(/\s+/);
      if (parts.length < 2) continue;

      const rawType = parts[0];
      const baseType = rawType.split(":")[0];
      if (!ITEM_TYPES.has(baseType)) continue;

      const itemName = parts[1];
      const channelMatch = line.match(channelRegex);
      if (!channelMatch) continue;

      const rawChannel = channelMatch[1];
      const channelParts = rawChannel.split(":");

      if (channelParts.length >= 4) {
        links.push({
          file: path.basename(file),
          line: i + 1,
          item: itemName,
          thing: channelParts[2],
          channel: channelParts[3],
          raw: rawChannel,
        });
      }
    }
  }

  return links;
}

function collectSitemapRefs() {
  const refs = new Set();
  const files = getFiles(SITEMAPS_DIR, ".sitemap");
  const regex = /\bitem\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/g;

  for (const file of files) {
    const content = readText(file);
    let match;
    while ((match = regex.exec(content)) !== null) {
      refs.add(match[1]);
    }
  }

  return refs;
}

function collectRuleRefs() {
  const refs = new Set();
  const files = getFiles(RULES_DIR, ".rules");

  const patterns = [
    /\b(?:postUpdate|sendCommand)\(\s*([A-Za-z_][A-Za-z0-9_]*)/g,
    /\b([A-Za-z_][A-Za-z0-9_]*)\.(?:state|postUpdate|sendCommand)\b/g,
    /\breceived\s+(?:command|update|change)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi,
    /\bMember of\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
  ];

  for (const file of files) {
    const content = readText(file);

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        refs.add(match[1]);
      }
    }
  }

  return refs;
}

function checkBasicSyntax() {
  const errors = [];
  const filesToCheck = [
    ...getFiles(ITEMS_DIR, ".items"),
    ...getFiles(THINGS_DIR, ".things"),
    ...getFiles(SITEMAPS_DIR, ".sitemap"),
    ...getFiles(PERSISTENCE_DIR, ".persist"),
  ];

  for (const file of filesToCheck) {
    const content = readText(file);
    const openBraces = (content.match(/{/g) || []).length;
    const closeBraces = (content.match(/}/g) || []).length;

    if (openBraces !== closeBraces) {
      errors.push(`Bracket mismatch in ${path.relative(ROOT, file)}`);
    }
  }

  for (const file of getFiles(RULES_DIR, ".rules")) {
    const content = readText(file);
    const ruleCount = (content.match(/^\s*rule\b/gm) || []).length;
    const endCount = (content.match(/^\s*end\b/gm) || []).length;

    if (ruleCount !== endCount) {
      errors.push(
        `Possible incomplete rule block in ${path.relative(ROOT, file)} (rule=${ruleCount}, end=${endCount})`
      );
    }
  }

  for (const file of getFiles(SITEMAPS_DIR, ".sitemap")) {
    const content = readText(file);
    if (!content.includes("sitemap")) {
      errors.push(`Missing 'sitemap' declaration in ${path.relative(ROOT, file)}`);
    }
  }

  return errors;
}

function checkYamlFiles() {
  const errors = [];
  const files = walkFiles(ROOT).filter(
    (file) => file.endsWith(".yml") || file.endsWith(".yaml")
  );

  for (const file of files) {
    try {
      yaml.load(readText(file));
    } catch (error) {
      errors.push(`Invalid YAML in ${path.relative(ROOT, file)}: ${error.message}`);
    }
  }

  return errors;
}

function checkJsonFiles() {
  const errors = [];
  const files = walkFiles(ROOT).filter((file) => file.endsWith(".json"));

  for (const file of files) {
    try {
      JSON.parse(readText(file));
    } catch (error) {
      errors.push(`Invalid JSON in ${path.relative(ROOT, file)}: ${error.message}`);
    }
  }

  return errors;
}

function checkSemantics() {
  const errors = [];
  const warnings = [];

  const itemNames = extractItemNames();
  const thingChannels = collectThingsAndChannels();
  const itemLinks = collectItemLinks();
  const sitemapRefs = collectSitemapRefs();
  const ruleRefs = collectRuleRefs();

  for (const ref of [...sitemapRefs].sort()) {
    if (!itemNames.has(ref)) {
      errors.push(`Sitemap references missing item: ${ref}`);
    }
  }

  for (const ref of [...ruleRefs].sort()) {
    if (!itemNames.has(ref)) {
      warnings.push(`Rule references unknown item/group: ${ref}`);
    }
  }

  for (const link of itemLinks) {
    if (!thingChannels.has(link.thing)) {
      errors.push(
        `${link.file}:${link.line} -> item '${link.item}' references missing Thing '${link.thing}'`
      );
      continue;
    }

    const channels = thingChannels.get(link.thing);
    if (!channels.has(link.channel)) {
      errors.push(
        `${link.file}:${link.line} -> item '${link.item}' references missing channel '${link.channel}' on Thing '${link.thing}'`
      );
    }
  }

  const usedItems = new Set([
    ...sitemapRefs,
    ...ruleRefs,
    ...itemLinks.map((link) => link.item),
  ]);

  for (const item of [...itemNames].sort()) {
    if (!usedItems.has(item)) {
      warnings.push(`Possibly unused item: ${item}`);
    }
  }

  return { errors, warnings };
}

function printBlock(title, values) {
  if (!values.length) return;
  console.log(`\n${title}`);
  for (const value of values) {
    console.log(`- ${value}`);
  }
}

function main() {
  const errors = [];
  const warnings = [];

  errors.push(...ensureRequiredDirs());
  errors.push(...ensureRequiredFiles());
  errors.push(...checkBasicSyntax());
  errors.push(...checkYamlFiles());
  errors.push(...checkJsonFiles());

  const semantic = checkSemantics();
  errors.push(...semantic.errors);
  warnings.push(...semantic.warnings);

  printBlock("WARNINGS", warnings);

  if (errors.length) {
    printBlock("VALIDATION FAILED", errors);
    process.exit(1);
  }

  console.log("\nVALIDATION PASSED");
}

main();