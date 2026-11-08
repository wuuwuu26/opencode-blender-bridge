// Builds assets/addon/opencode_blender_bridge.zip with the add-on package at
// the archive root (Blender expects a package directory inside the zip).
// LICENSE and NOTICE are copied into the package so the distributed zip carries
// the Apache-2.0 license and third-party attributions.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const source = path.join(root, "assets", "addon", "opencode_blender_bridge")
const output = path.join(root, "assets", "addon", "opencode_blender_bridge.zip")

if (!fs.existsSync(source)) {
  console.error("add-on directory missing:", source)
  process.exit(1)
}

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ocbb-addon-"))
const stagedPackage = path.join(stage, "opencode_blender_bridge")
fs.cpSync(source, stagedPackage, { recursive: true })
for (const name of ["LICENSE", "NOTICE"]) {
  const from = path.join(root, name)
  if (!fs.existsSync(from)) {
    console.error(`missing ${name}; cannot build an Apache-2.0 add-on archive`)
    process.exit(1)
  }
  fs.copyFileSync(from, path.join(stagedPackage, name))
}

try {
  fs.unlinkSync(output)
} catch {
  // no previous zip
}

try {
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${stagedPackage}' -DestinationPath '${output}' -CompressionLevel Optimal -Force`,
      ],
      { stdio: "inherit" },
    )
  } else {
    execFileSync("zip", ["-r", output, "opencode_blender_bridge"], {
      cwd: stage,
      stdio: "inherit",
    })
  }
} finally {
  fs.rmSync(stage, { recursive: true, force: true })
}

const bytes = fs.statSync(output).size
console.log(`add-on zip: ${output} (${bytes} bytes, includes LICENSE and NOTICE)`)
