import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { Host } from "../host.js"
import { ADDON_PROTOCOL_VERSION, PLUGIN_VERSION } from "../config.js"
import { BridgeError } from "../bridge.js"
import { addonRoot, launchScript } from "../paths.js"
import { blenderVersion, waitForPort } from "../blender.js"
import { errorResult, guarded, num, objectSchema, str, textResult, bool, type ToolOutput } from "./common.js"
import { jsonText, readJson, writeJson } from "../util.js"

interface Lease {
  owner: string
  at: number
  ttlMs: number
  note?: string
}

function leaseFile(host: Host): string {
  return path.join(host.dataDir, "lease.json")
}

export function viewportTool(host: Host) {
  return {
    name: "blender_viewport",
    description:
      "Bridge lifecycle and diagnostics: status, health, doctor, launch, and an advisory write lease shared by sessions. " +
      "doctor is the acceptance check (kind=ok means OpenCode can drive the GUI). launch starts Blender with the bundled add-on loaded " +
      "even if it is not installed in Blender preferences.",
    input: objectSchema({
      op: { type: "string", description: "status | health | doctor | launch | lease" },
      action: { type: "string", description: "lease action: acquire | release | status" },
      owner: { type: "string", description: "Lease owner; defaults to this OpenCode session." },
      ttl_ms: { type: "integer", description: "Lease time-to-live. Default 900000." },
      note: { type: "string", description: "Free-form lease note." },
      file: { type: "string", description: "Optional .blend to open for op=launch." },
      blender: { type: "string", description: "Blender executable override." },
      timeout_ms: { type: "integer", description: "launch wait timeout. Default 90000." },
      force: { type: "boolean", description: "lease acquire: replace a live lease held by someone else." },
    }, ["op"]),
    async execute(input: Record<string, unknown>, context?: { sessionID?: string }): Promise<ToolOutput> {
      return guarded(async () => {
        const op = str(input.op, "status").toLowerCase()
        const probe = host.blenderProbe()
        const owner = str(input.owner) || context?.sessionID || "session"

        if (op === "health") {
          const started = Date.now()
          const ok = await host.bridge.ping(2000)
          return textResult(
            ok
              ? `bridge ok · 127.0.0.1:${host.config.port} · ${Date.now() - started} ms`
              : `bridge unreachable · 127.0.0.1:${host.config.port}`,
            { ok, ms: Date.now() - started },
          )
        }

        if (op === "status") {
          let info: Record<string, unknown> | undefined
          let error: string | undefined
          try {
            info = await host.bridge.info(4000)
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught)
          }
          const lines = [
            `plugin ${PLUGIN_VERSION} · port ${host.config.port}`,
            `blender: ${probe.path ? probe.path : "not found"}`,
            info
              ? `bridge: connected · ${str(info.name)} · Blender ${str(info.blender_version)} · ${Array.isArray(info.capabilities) ? info.capabilities.length : "?"} commands`
              : `bridge: offline${error ? " · " + error : ""}`,
            `headless sessions: ${host.workers.list().length}`,
            `project data: ${host.dataDir}`,
          ]
          return textResult(lines.join("\n"), { connected: Boolean(info) })
        }

        if (op === "doctor") {
          const checks: Array<{ name: string; ok: boolean; detail: string }> = []
          checks.push({
            name: "blender_executable",
            ok: Boolean(probe.path),
            detail: probe.path || probe.error || "not found",
          })
          if (probe.path) {
            const version = await blenderVersion(probe.path, 20_000)
            checks.push({ name: "blender_version", ok: Boolean(version), detail: version || "could not read --version" })
          }
          let info: Record<string, unknown> | undefined
          let bridgeError: string | undefined
          try {
            info = await host.bridge.info(5000)
            checks.push({ name: "bridge", ok: true, detail: `${str(info.name)} on 127.0.0.1:${host.config.port}` })
            checks.push({
              name: "protocol",
              ok: num(info.protocol_version, -1) === ADDON_PROTOCOL_VERSION,
              detail: `add-on ${num(info.protocol_version, -1)}, host ${ADDON_PROTOCOL_VERSION}`,
            })
            checks.push({
              name: "gui_mode",
              ok: info.background !== true,
              detail: info.background === true ? "add-on is running in background mode" : "interactive session",
            })
          } catch (caught) {
            bridgeError = caught instanceof Error ? caught.message : String(caught)
            checks.push({ name: "bridge", ok: false, detail: bridgeError })
          }
          let writable = true
          try {
            fs.accessSync(host.dataDir, fs.constants.W_OK)
            fs.accessSync(host.framesDir, fs.constants.W_OK)
          } catch {
            writable = false
          }
          checks.push({ name: "writable_dirs", ok: writable, detail: host.dataDir })
          checks.push({
            name: "worker",
            ok: Boolean(probe.path),
            detail: probe.path ? "headless fallback available" : "needs a Blender executable",
          })
          const ok = checks.every((check) => check.ok)
          const kind = ok
            ? "ok"
            : info && info.background === true
              ? "background_only"
              : info
                ? "degraded"
                : probe.path
                  ? "gui_offline"
                  : "no_blender"
          const lines = [`doctor · kind=${kind}`, ...checks.map((check) => `  [${check.ok ? "ok" : "!!"}] ${check.name}: ${check.detail}`)]
          if (!ok)
            lines.push(
              "",
              kind === "gui_offline"
                ? "Blender is installed but the bridge is not connected. Open Blender > 3D viewport > N panel > OpenCode > Connect, or run blender_viewport op=launch."
                : kind === "background_only"
                  ? "Connected to a headless worker, so GUI checks do not apply. Headless tools are ready; connect a desktop Blender for GUI frames."
                  : "Fix the failed checks above, then rerun doctor. Headless tools only need the Blender executable.",
            )
          return textResult(lines.join("\n"), { kind, ok, checks })
        }

        if (op === "launch") {
          if (await host.bridge.ping(1200)) return textResult(`bridge already connected on 127.0.0.1:${host.config.port}`)
          const blender = str(input.blender) || probe.path
          if (!blender)
            return errorResult(
              "Blender executable not found",
              "Set blenderPath in plugin options, OCBB_BLENDER, or install Blender from blender.org.",
            )
          const logFile = path.join(host.dataDir, "launch.log")
          const out = fs.createWriteStream(logFile, { flags: "a" })
          const args = [
            "--python",
            launchScript,
            "--",
            "--addon-path",
            addonRoot,
            "--port",
            String(host.config.port),
          ]
          if (str(input.file)) args.push("--file", path.resolve(str(input.file)))
          const child = spawn(blender, args, {
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: false,
            env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
          })
          child.stdout?.pipe(out)
          child.stderr?.pipe(out)
          child.unref()
          const ready = await waitForPort(host.config.port, num(input.timeout_ms, 90_000))
          return textResult(
            ready
              ? `Blender launched and bridge connected on 127.0.0.1:${host.config.port} · pid ${child.pid}`
              : `Blender launched (pid ${child.pid}) but the bridge did not answer yet. Check ${logFile}.`,
            { ready, pid: child.pid, log: logFile },
          )
        }

        if (op === "lease") {
          const action = str(input.action, "status").toLowerCase()
          const file = leaseFile(host)
          const current = readJson<Lease | undefined>(file, undefined)
          const live = current && Date.now() - current.at < current.ttlMs
          if (action === "status") {
            return textResult(current ? `${live ? "held" : "expired"} by ${current.owner} · ${jsonText(current, 2000)}` : "no lease")
          }
          if (action === "release") {
            if (current && current.owner !== owner && !bool(input.force))
              return errorResult(`Lease is held by ${current.owner}`, "Pass force=true only if you know that session is gone.")
            try {
              fs.unlinkSync(file)
            } catch {
              // already gone
            }
            return textResult("lease released")
          }
          if (action === "acquire") {
            if (live && current && current.owner !== owner && !bool(input.force))
              return errorResult(
                `Another session holds the write lease: ${current.owner}`,
                "Use separate headless workers for parallel work, or wait until the lease expires.",
              )
            const lease: Lease = {
              owner,
              at: Date.now(),
              ttlMs: Math.max(30_000, num(input.ttl_ms, 900_000)),
              note: str(input.note) || undefined,
            }
            writeJson(file, lease)
            return textResult(`lease acquired by ${owner} for ${Math.round(lease.ttlMs / 1000)}s`)
          }
          return errorResult("Unknown lease action: " + action, "action is acquire | release | status")
        }

        return errorResult("Unknown op: " + op, "op is status | health | doctor | launch | lease")
      })
    },
  }
}
