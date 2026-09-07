const fs = require("fs");
const Module = require("module");
const path = require("path");

const indexPath = path.join(__dirname, "index.js");
let source = fs.readFileSync(indexPath, "utf8");

source = source.replace(
  'const TIMER_FULL_ROLE_NAMES = [\n    "Generał Inspektor SW ⚖️👑",\n    "Generał SW ⚖️⭐"\n];\nconst TIMER_EMPLOYEE_ROLE_NAME = "Pracownik SW";',
  'const TIMER_FULL_ROLE_NAMES = [\n    "Generał Inspektor SW ⚖️👑",\n    "Generał SW ⚖️⭐"\n];\nconst TIMER_EMPLOYEE_ROLE_NAME = "Pracownik SW";'
);

source = source.replace(
  /\nfunction hasTimerPermission\(interaction\) \{[\s\S]*?\n\}\n\nfunction createOsadzonyId/, 
  "\nfunction createOsadzonyId"
);

const mod = new Module(indexPath, module);
mod.filename = indexPath;
mod.paths = Module._nodeModulePaths(__dirname);
mod._compile(source, indexPath);
