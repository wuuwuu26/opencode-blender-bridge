// Builds assets/addon/opencode_blender_bridge.zip with the add-on package at
// the archive root (Blender expects a package directory inside the zip).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const source = path.join(root, "assets", "addon", "opencode_blender_bridge")
const output = path.join(root, "assets", "addon", "opencode_blender_bridge.zip")

if (!fs.existsSync(source)) {
  console.error("add-on directory missing:", source)
  process.exit(1)
}
try {
  fs.unlinkSync(output)
} catch {
  // no previous zip
}

if (process.platform === "win32") {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${source}' -DestinationPath '${output}' -CompressionLevel Optimal -Force`,
    ],
    { stdio: "inherit" },
  )
} else {
  execFileSync("zip", ["-r", output, "opencode_blender_bridge"], {
    cwd: path.join(root, "assets", "addon"),
    stdio: "inherit",
  })
}

const bytes = fs.statSync(output).size
console.log(`add-on zip: ${output} (${bytes} bytes)`)
