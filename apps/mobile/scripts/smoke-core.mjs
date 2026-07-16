/**
 * Structural + domain smoke for the mobile client.
 * Asserts App.tsx is a real playable shell (not Expo placeholder only)
 * and that core package-entry tests still pass.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "..");
const appTsx = path.resolve(mobileRoot, "App.tsx");
const coreRoot = path.resolve(mobileRoot, "../../packages/core");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(appTsx)) fail("App.tsx missing");
const appSrc = readFileSync(appTsx, "utf8");
if (!appSrc.includes('from "@versemark/core"')) {
  fail('App.tsx must import from @versemark/core');
}

const requiredCore = [
  "startDailyRound",
  "startEndlessRound",
  "loadState",
  "markAchievementsSeen",
];
for (const name of requiredCore) {
  if (!appSrc.includes(name)) fail(`App.tsx must use ${name} from core`);
}

// Surface files must exist (not WebView of apps/web)
const surfaces = [
  "src/screens/HomeScreen.tsx",
  "src/screens/PlayScreen.tsx",
  "src/screens/AchievementsScreen.tsx",
  "src/components/TimelineStrip.tsx",
  "src/lib/storage-native.ts",
  "src/lib/haptics.ts",
  "src/lib/placement.ts",
  "src/lib/share.ts",
];
for (const rel of surfaces) {
  if (!existsSync(path.join(mobileRoot, rel))) fail(`missing ${rel}`);
}

const playSrc = readFileSync(
  path.join(mobileRoot, "src/screens/PlayScreen.tsx"),
  "utf8"
);
for (const name of [
  "confirmGuess",
  "takeHint",
  "shareForRound",
  "TimelineStrip",
  "hapticResult",
  "hapticWarning",
  "shareText",
]) {
  if (!playSrc.includes(name)) fail(`PlayScreen must use ${name}`);
}

const timelineSrc = readFileSync(
  path.join(mobileRoot, "src/components/TimelineStrip.tsx"),
  "utf8"
);
if (!timelineSrc.includes("hapticConfirm")) {
  fail("TimelineStrip must confirm a committed marker placement");
}

const storageSrc = readFileSync(
  path.join(mobileRoot, "src/lib/storage-native.ts"),
  "utf8"
);
if (!storageSrc.includes('import("expo-sqlite")')) {
  fail("storage-native must use expo-sqlite as its authoritative store");
}
if (!storageSrc.includes("migrateLegacyAsyncStorage")) {
  fail("storage-native must preserve the one-time AsyncStorage migration");
}
if (!storageSrc.includes("setStorageBackend")) {
  fail("storage-native must call setStorageBackend");
}

const hapticsSrc = readFileSync(
  path.join(mobileRoot, "src/lib/haptics.ts"),
  "utf8"
);
if (!hapticsSrc.includes("expo-haptics")) {
  fail("haptics must use expo-haptics");
}

const pkg = JSON.parse(
  readFileSync(path.join(mobileRoot, "package.json"), "utf8")
);
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const dep of [
  "expo-haptics",
  "expo-sqlite",
  "@react-native-async-storage/async-storage",
  "@versemark/core",
]) {
  if (!deps[dep]) fail(`package.json missing dependency ${dep}`);
}

// Must not be a WebView shell of the website
if (appSrc.includes("WebView") || appSrc.includes("apps/web")) {
  fail("mobile must not WebView the web app");
}

const r = spawnSync(
  "npx",
  ["vitest", "run", "tests/package-entry.test.ts"],
  { cwd: coreRoot, encoding: "utf8", shell: true }
);
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
if (r.status !== 0) {
  fail("core package-entry tests (shared import path)");
}

console.log(
  "OK: mobile play surfaces + SQLite durability + haptics + @versemark/core wiring"
);
