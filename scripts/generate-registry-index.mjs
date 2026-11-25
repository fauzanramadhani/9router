// Preserve registry ordering and intentionally hidden entries while discovering new files.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const dir = new URL("../open-sse/providers/registry/", import.meta.url);
const target = new URL("index.js", dir);
let source = readFileSync(target, "utf8");
const known = new Set([...source.matchAll(/from "\.\/(.+\.js)"/g)].map(m => m[1]));
const files = readdirSync(dir).filter(f => f.endsWith(".js") && f !== "index.js" && !known.has(f)).sort();
for (const file of files) {
  const name = `p_${file.replace(/[^a-zA-Z0-9]/g, "_")}`;
  source = source.replace("export default [", `import ${name} from "./${file}";\nexport default [`);
  source = source.replace(/\];\s*$/, `  ${name},\n];\n`);
}
writeFileSync(target, source);
console.log(`Registry index: added ${files.length} entries`);
