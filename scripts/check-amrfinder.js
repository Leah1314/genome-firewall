const { execFile } = require("node:child_process");

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(`${stdout}${stderr}`.trim());
    });
  });
}

async function main() {
  const version = await run("amrfinder", ["--version"]);
  console.log(JSON.stringify({
    executable: "amrfinder",
    version,
    note: "Record the database version emitted by each production AMRFinderPlus run in the dataset manifest.",
  }, null, 2));
}

main().catch((error) => {
  console.error(`AMRFinderPlus check failed: ${error.message}`);
  console.error("Create the pinned environment with: conda env create -f environment-amrfinder.yml");
  process.exitCode = 1;
});
