const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const cli = require.resolve("@tauri-apps/cli/tauri.js");
const args = process.argv.slice(2);

function hasConfigOption(argv) {
  return argv.some(
    (arg) =>
      arg === "--config" ||
      arg === "-c" ||
      arg.startsWith("--config="),
  );
}

if (args[0] === "dev" && !hasConfigOption(args)) {
  args.push("--config", resolve("src-tauri/tauri.dev.conf.json"));
}

const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exitCode = result.status ?? 1;
