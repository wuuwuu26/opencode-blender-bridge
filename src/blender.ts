import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { lookPath, sleep } from "./util.js"

export interface BlenderProbe {
  path?: string
  version?: string
  source?: string
  error?: string
}

let cached: BlenderProbe | undefined

function windowsCandidates(): string[] {
  const roots = [
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Blender Foundation"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Blender Foundation"),
    path.join(process.env["LOCALAPPDATA"] || "", "Programs", "Blender Foundation"),
  ].filter(Boolean)
  const result: string[] = []
  for (const root of roots) {
    try {
      const dirs = fs
        .readdirSync(root)
        .filter((name) => name.toLowerCase().startsWith("blender"))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const dir of dirs) result.push(path.join(root, dir, "blender.exe"))
    } catch {
      // no Blender in this root
    }
  }
  return result
}

export function findBlender(configured?: string): BlenderProbe {
  if (cached && !configured) return cached
  const candidates: Array<{ file?: string; source: string }> = []
  if (configured) candidates.push({ file: configured, source: "config" })
  if (process.env.OCBB_BLENDER) candidates.push({ file: process.env.OCBB_BLENDER, source: "OCBB_BLENDER" })
  if (process.env.BLENDER_PATH) candidates.push({ file: process.env.BLENDER_PATH, source: "BLENDER_PATH" })
  if (process.platform === "win32") {
    for (const file of windowsCandidates()) candidates.push({ file, source: "Program Files" })
    candidates.push({ file: lookPath("blender"), source: "PATH" })
  } else if (process.platform === "darwin") {
    candidates.push({ file: "/Applications/Blender.app/Contents/MacOS/Blender", source: "Applications" })
    candidates.push({ file: lookPath("blender"), source: "PATH" })
  } else {
    candidates.push({ file: lookPath("blender"), source: "PATH" })
    candidates.push({ file: "/usr/bin/blender", source: "system" })
    candidates.push({ file: "/snap/bin/blender", source: "snap" })
  }
  for (const candidate of candidates) {
    if (!candidate.file) continue
    try {
      if (fs.existsSync(candidate.file) && fs.statSync(candidate.file).isFile()) {
        const probe: BlenderProbe = { path: candidate.file, source: candidate.source }
        if (!configured) cached = probe
        return probe
      }
    } catch {
      // ignore
    }
  }
  return { error: "Blender executable not found. Set blenderPath in plugin options or OCBB_BLENDER." }
}

export function blenderVersion(executable: string, timeoutMs = 15000): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(executable, ["--version"], { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(undefined)
        return
      }
      const match = String(stdout).match(/Blender\s+([0-9][^\s]*)/i)
      resolve(match ? match[1] : undefined)
    })
  })
}

export async function waitForPort(port: number, timeoutMs = 60000, signal?: AbortSignal): Promise<boolean> {
  const bridge = await import("./bridge.js")
  const client = new bridge.BridgeClient("127.0.0.1", port)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) return false
    if (await client.ping(1000)) return true
    await sleep(400)
  }
  return false
}

export async function freePort(): Promise<number> {
  const net = await import("node:net")
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}
