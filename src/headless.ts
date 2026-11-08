import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { addonRoot, headlessWrapper } from "./paths.js"
import { ensureDir, jsonText, num, safeName, sleep, stamp, writeJson } from "./util.js"

export interface HeadlessArgs {
  script?: string
  script_file?: string
  file?: string
  outdir?: string
  timeout_ms?: number
  engine?: string
  args?: string
  workdir?: string
  factory_startup?: boolean
  env?: Record<string, string>
  shots?: Array<Record<string, unknown>>
  hard_exit?: boolean
  include_noise?: boolean
}

export interface HeadlessPayload {
  ok: boolean
  result?: unknown
  stdout?: string
  stderr?: string
  error?: string | null
  traceback?: string | null
  files?: Array<{ name: string; path: string; bytes: number }>
  shots?: Array<{ name: string; filepath: string; info: unknown }>
  wall_ms?: number
}

export interface HeadlessResult {
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  runDir: string
  resultPath: string
  stdoutPath: string
  stderrPath: string
  payload: HeadlessPayload
  stdoutTail: string
  stderrTail: string
}

export interface HeadlessHandle {
  runDir: string
  resultPath: string
  stdoutPath: string
  stderrPath: string
  child: ChildProcessWithoutNullStreams
  startedAt: number
  done: Promise<HeadlessResult>
}

export interface HeadlessHost {
  blenderPath?: string
  dataDir: string
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === "win32") {
    try {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => undefined)
    } catch {
      // ignore
    }
    return
  }
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // already gone
  }
}

export function startHeadless(
  host: HeadlessHost,
  args: HeadlessArgs,
  options: { signal?: AbortSignal; runId?: string } = {},
): HeadlessHandle {
  if (!host.blenderPath) {
    throw new Error("Blender executable not found. Set blenderPath in plugin options or OCBB_BLENDER.")
  }
  if (!args.script && !args.script_file) {
    throw new Error("blender_rt_headless needs script or script_file")
  }
  const runId = args.script_file
    ? stamp() + "-" + safeName(path.basename(args.script_file, path.extname(args.script_file)))
    : stamp() + "-" + (options.runId || Math.random().toString(36).slice(2, 8))
  const runDir = ensureDir(path.join(host.dataDir, "runs", runId))
  const outdir = ensureDir(args.outdir ? path.resolve(args.outdir) : path.join(runDir, "out"))
  let scriptFile = args.script_file ? path.resolve(args.script_file) : path.join(runDir, "script.py")
  if (!args.script_file) fs.writeFileSync(scriptFile, args.script || "", "utf8")
  if (!fs.existsSync(scriptFile)) throw new Error("Script file not found: " + scriptFile)
  if (args.file && !fs.existsSync(path.resolve(args.file))) throw new Error("Blend file not found: " + args.file)

  const resultPath = path.join(runDir, "result.json")
  const stdoutPath = path.join(runDir, "stdout.log")
  const stderrPath = path.join(runDir, "stderr.log")
  const configPath = path.join(runDir, "config.json")
  writeJson(configPath, {
    script: scriptFile,
    result_path: resultPath,
    addon_path: addonRoot,
    outdir,
    file: args.file ? path.resolve(args.file) : "",
    engine: args.engine || "eevee",
    workdir: args.workdir ? path.resolve(args.workdir) : "",
    args: args.args ? args.args.split(/\s+/).filter(Boolean) : [],
    shots: args.shots || [],
    hard_exit: args.hard_exit !== false,
  })

  const commandArgs: string[] = []
  if (args.factory_startup !== false) commandArgs.push("--factory-startup")
  commandArgs.push("--background", "--python", headlessWrapper)

  const child = spawn(host.blenderPath, commandArgs, {
    cwd: args.workdir ? path.resolve(args.workdir) : runDir,
    env: {
      ...process.env,
      ...(args.env || {}),
      OCBB_HEADLESS_CONFIG: configPath,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
    windowsHide: true,
  })
  const out = fs.createWriteStream(stdoutPath)
  const err = fs.createWriteStream(stderrPath)
  child.stdout.pipe(out)
  child.stderr.pipe(err)

  const timeoutMs = Math.max(10_000, num(args.timeout_ms, 180_000))
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    killTree(child.pid)
  }, timeoutMs)
  timer.unref?.()

  const abortHandler = () => killTree(child.pid)
  options.signal?.addEventListener("abort", abortHandler, { once: true })

  const done = new Promise<HeadlessResult>((resolve) => {
    child.once("exit", (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abortHandler)
      void (async () => {
        out.end()
        err.end()
        await sleep(80)
        const payload = readPayload(resultPath)
        const files = listFiles(outdir, args.include_noise === true)
        resolve({
          ok: Boolean(payload?.ok) && !timedOut,
          exitCode: code,
          timedOut,
          runDir,
          resultPath,
          stdoutPath,
          stderrPath,
          payload: { ok: Boolean(payload?.ok), ...(payload || {}), files },
          stdoutTail: tailFile(stdoutPath, 30),
          stderrTail: tailFile(stderrPath, 30),
        })
      })()
    })
  })

  return { runDir, resultPath, stdoutPath, stderrPath, child, startedAt: Date.now(), done }
}

function readPayload(file: string): HeadlessPayload | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as HeadlessPayload
  } catch {
    return undefined
  }
}

function tailFile(file: string, lines = 30): string {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .slice(-lines)
      .join("\n")
      .trim()
  } catch {
    return ""
  }
}

export function listFiles(dir: string, includeNoise = false): Array<{ name: string; path: string; bytes: number }> {
  const files: Array<{ name: string; path: string; bytes: number }> = []
  try {
    for (const name of fs.readdirSync(dir).sort()) {
      if (!includeNoise && (name === "__pycache__" || name.endsWith(".blend1") || name === "result.json")) continue
      const full = path.join(dir, name)
      const stat = fs.statSync(full)
      if (stat.isFile()) files.push({ name, path: full, bytes: stat.size })
    }
  } catch {
    // missing outdir
  }
  return files
}

export function summarizeHeadless(result: HeadlessResult): string {
  const lines: string[] = []
  lines.push(
    `headless ${result.ok ? "ok" : "failed"} · exit ${result.exitCode ?? "null"} · ${result.timedOut ? "TIMEOUT" : (result.payload.wall_ms ?? 0) + " ms"}`,
  )
  if (result.payload.error) lines.push("error: " + result.payload.error)
  if (result.payload.traceback) lines.push("traceback:\n" + result.payload.traceback)
  if (result.payload.stdout) lines.push("stdout:\n" + result.payload.stdout.slice(-4000))
  if (result.payload.stderr) lines.push("stderr:\n" + result.payload.stderr.slice(-3000))
  if (result.payload.result !== undefined && result.payload.result !== null)
    lines.push("result: " + jsonText(result.payload.result, 3000))
  if (result.payload.shots?.length)
    lines.push("shots: " + result.payload.shots.map((shot) => `${shot.name}=${shot.filepath}`).join(", "))
  if (result.payload.files?.length)
    lines.push("files: " + result.payload.files.map((file) => `${file.name} (${file.bytes} B)`).join(", "))
  else if (!result.payload.stdout && !result.payload.stderr) lines.push("(no output)")
  lines.push("run: " + result.runDir)
  return lines.join("\n")
}
