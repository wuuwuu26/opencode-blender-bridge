import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { addonRoot, workerScript } from "./paths.js"
import { BridgeClient, BridgeError } from "./bridge.js"
import { freePort } from "./blender.js"
import { ensureDir, num, sleep } from "./util.js"

export interface WorkerOptions {
  blender: () => string | undefined
  dataDir: string
  ttlMs: number
}

export interface WorkerSession {
  name: string
  port: number
  pid?: number
  child: ChildProcessWithoutNullStreams
  client: BridgeClient
  startedAt: number
  lastUsed: number
  busy: boolean
  blender: string
  file?: string
  stderr: string
  ready: boolean
}

export interface WorkerStartOptions {
  name?: string
  blender?: string
  file?: string
  engine?: string
  warmup?: boolean
  timeoutMs?: number
}

export interface WorkerViewOptions {
  max_size?: number
  from?: string | [number, number, number]
  look_at?: string | [number, number, number]
  lens?: number
  ortho?: boolean
  view_size?: string
  filepath: string
}

export class WorkerManager {
  private readonly sessions = new Map<string, WorkerSession>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly options: WorkerOptions
  private readonly reaper: NodeJS.Timeout

  constructor(options: WorkerOptions) {
    this.options = options
    this.reaper = setInterval(() => this.reap(), 30_000)
    this.reaper.unref?.()
  }

  has(name: string): boolean {
    return this.sessions.has(name)
  }

  list(): Array<Record<string, unknown>> {
    return [...this.sessions.values()].map((session) => ({
      name: session.name,
      port: session.port,
      pid: session.pid,
      ready: session.ready && session.child.exitCode === null,
      busy: session.busy,
      idle_ms: Date.now() - session.lastUsed,
      started_at: new Date(session.startedAt).toISOString(),
      file: session.file,
    }))
  }

  async start(options: WorkerStartOptions = {}): Promise<Record<string, unknown>> {
    const name = options.name || "default"
    const existing = this.sessions.get(name)
    if (existing && existing.child.exitCode === null) {
      if (options.file && existing.file !== options.file) {
        await this.stop(name)
      } else {
        return { name, port: existing.port, pid: existing.pid, state: "already_running" }
      }
    }
    const blender = options.blender || this.options.blender() || "blender"
    const port = await freePort()
    const outDir = ensureDir(path.join(this.options.dataDir, "workers", name))
    const args = [
      "--background",
      "--factory-startup",
      "--python",
      workerScript,
      "--",
      "--port",
      String(port),
      "--addon-path",
      addonRoot,
    ]
    if (options.file) args.push("--file", path.resolve(options.file))
    const child = spawn(blender, args, {
      cwd: outDir,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        OCBB_OUT_DIR: outDir,
      },
      windowsHide: true,
    })
    const session: WorkerSession = {
      name,
      port,
      pid: child.pid,
      child,
      client: new BridgeClient("127.0.0.1", port),
      startedAt: Date.now(),
      lastUsed: Date.now(),
      busy: false,
      blender,
      file: options.file ? path.resolve(options.file) : undefined,
      stderr: "",
      ready: false,
    }
    child.stderr.on("data", (chunk) => {
      session.stderr = (session.stderr + chunk.toString("utf8")).slice(-20_000)
    })
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8")
      if (text.includes("OCBB_READY")) session.ready = true
    })
    child.once("exit", (code) => {
      session.ready = false
      const log = path.join(outDir, "worker.log")
      try {
        fs.writeFileSync(log, session.stderr, "utf8")
      } catch {
        // ignore
      }
      if (code !== null && code !== 0) {
        session.stderr += `\nworker exited with code ${code}`
      }
    })
    this.sessions.set(name, session)

    const deadline = Date.now() + Math.max(15_000, num(options.timeoutMs, 90_000))
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        this.sessions.delete(name)
        throw new Error(
          `Blender headless worker exited during startup (code ${child.exitCode}).\n${session.stderr.slice(-4000)}`,
        )
      }
      if (await session.client.ping(800)) {
        session.ready = true
        if (options.engine) {
          await session.client.call("set_render_settings", { engine: options.engine }, { timeoutMs: 30_000 }).catch(() => undefined)
        }
        return { name, port, pid: child.pid, state: "started", blender }
      }
      await sleep(350)
    }
    await this.stop(name)
    throw new Error(
      `Blender worker did not become ready within the timeout. Is "${blender}" a valid Blender executable?\n` +
        session.stderr.slice(-3000),
    )
  }

  private queue<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(name) ?? Promise.resolve()
    const next = previous.then(fn, fn)
    this.queues.set(
      name,
      next.catch(() => undefined),
    )
    return next
  }

  async exec(
    name: string,
    code: string | undefined,
    options: { file?: string; timeoutMs?: number; blender?: string; signal?: AbortSignal } = {},
  ): Promise<Record<string, unknown>> {
    const session = await this.ensure(name, options.blender, options.signal)
    return this.queue(name, async () => {
      session.busy = true
      try {
        const response = await session.client.call<Record<string, unknown>>(
          "execute_code",
          { ...(code ? { code } : {}), ...(options.file ? { file: options.file } : {}) },
          { timeoutMs: options.timeoutMs ?? 120_000, signal: options.signal },
        )
        return { session: name, ...response.result, ms: response.ms }
      } finally {
        session.busy = false
        session.lastUsed = Date.now()
      }
    })
  }

  async see(name: string, options: WorkerViewOptions & { blender?: string; signal?: AbortSignal }): Promise<Record<string, unknown>> {
    const session = await this.ensure(name, options.blender, options.signal)
    return this.queue(name, async () => {
      session.busy = true
      try {
        const response = await session.client.call<Record<string, unknown>>(
          "render_view",
          {
            max_size: options.max_size ?? 640,
            filepath: options.filepath,
            from: options.from,
            look_at: options.look_at,
            lens: options.lens,
            ortho: options.ortho,
            view_size: options.view_size,
          },
          { timeoutMs: 120_000, signal: options.signal },
        )
        return { session: name, ...response.result }
      } finally {
        session.busy = false
        session.lastUsed = Date.now()
      }
    })
  }

  async reset(name: string, blender?: string): Promise<Record<string, unknown>> {
    const result = await this.exec(
      name,
      "bpy.ops.wm.read_factory_settings(use_empty=True)\nresult = {'reset': True}\n",
      { blender, timeoutMs: 60_000 },
    )
    return { name, ...result }
  }

  async status(name = "default", blender?: string): Promise<Record<string, unknown>> {
    const session = await this.ensure(name, blender)
    try {
      const info = await session.client.info(5000)
      return { name, port: session.port, pid: session.pid, ready: true, info }
    } catch (error) {
      return { name, port: session.port, pid: session.pid, ready: false, error: (error as Error).message }
    }
  }

  async stop(name: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(name)
    this.sessions.delete(name)
    if (!session) return { name, stopped: false }
    const pid = session.pid
    try {
      session.child.kill()
    } catch {
      // ignore
    }
    if (pid && process.platform === "win32") {
      await new Promise<void>((resolve) => {
        execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve())
      })
    }
    await sleep(200)
    return { name, stopped: true, pid }
  }

  async stopAll(): Promise<void> {
    clearInterval(this.reaper)
    const names = [...this.sessions.keys()]
    await Promise.all(names.map((name) => this.stop(name).catch(() => undefined)))
  }

  private async ensure(name: string, blender?: string, signal?: AbortSignal): Promise<WorkerSession> {
    let session = this.sessions.get(name)
    if (session && session.child.exitCode === null && (await session.client.ping(1000))) {
      session.lastUsed = Date.now()
      return session
    }
    if (session) await this.stop(name)
    await this.start({ name, blender, timeoutMs: 90_000 })
    session = this.sessions.get(name)
    if (!session) throw new BridgeError("unreachable", "Headless worker failed to start")
    if (signal?.aborted) throw new BridgeError("aborted", "Tool call was aborted")
    return session
  }

  private async reap(): Promise<void> {
    for (const [name, session] of this.sessions) {
      if (session.busy) continue
      if (Date.now() - session.lastUsed < this.options.ttlMs) continue
      try {
        await this.stop(name)
      } catch {
        // ignore
      }
    }
  }
}
