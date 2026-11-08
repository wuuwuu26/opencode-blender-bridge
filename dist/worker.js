import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { addonRoot, workerScript } from "./paths.js";
import { BridgeClient, BridgeError } from "./bridge.js";
import { freePort } from "./blender.js";
import { ensureDir, num, sleep } from "./util.js";
export class WorkerManager {
    sessions = new Map();
    queues = new Map();
    options;
    reaper;
    constructor(options) {
        this.options = options;
        this.reaper = setInterval(() => this.reap(), 30_000);
        this.reaper.unref?.();
    }
    has(name) {
        return this.sessions.has(name);
    }
    list() {
        return [...this.sessions.values()].map((session) => ({
            name: session.name,
            port: session.port,
            pid: session.pid,
            ready: session.ready && session.child.exitCode === null,
            busy: session.busy,
            idle_ms: Date.now() - session.lastUsed,
            started_at: new Date(session.startedAt).toISOString(),
            file: session.file,
        }));
    }
    async start(options = {}) {
        const name = options.name || "default";
        const existing = this.sessions.get(name);
        if (existing && existing.child.exitCode === null) {
            if (options.file && existing.file !== options.file) {
                await this.stop(name);
            }
            else {
                return { name, port: existing.port, pid: existing.pid, state: "already_running" };
            }
        }
        const blender = options.blender || this.options.blender() || "blender";
        const port = await freePort();
        const outDir = ensureDir(path.join(this.options.dataDir, "workers", name));
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
        ];
        if (options.file)
            args.push("--file", path.resolve(options.file));
        const child = spawn(blender, args, {
            cwd: outDir,
            env: {
                ...process.env,
                PYTHONIOENCODING: "utf-8",
                PYTHONUTF8: "1",
                OCBB_OUT_DIR: outDir,
            },
            windowsHide: true,
        });
        const session = {
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
        };
        child.stderr.on("data", (chunk) => {
            session.stderr = (session.stderr + chunk.toString("utf8")).slice(-20_000);
        });
        child.stdout.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            if (text.includes("OCBB_READY"))
                session.ready = true;
        });
        child.once("exit", (code) => {
            session.ready = false;
            const log = path.join(outDir, "worker.log");
            try {
                fs.writeFileSync(log, session.stderr, "utf8");
            }
            catch {
                // ignore
            }
            if (code !== null && code !== 0) {
                session.stderr += `\nworker exited with code ${code}`;
            }
        });
        this.sessions.set(name, session);
        const deadline = Date.now() + Math.max(15_000, num(options.timeoutMs, 90_000));
        while (Date.now() < deadline) {
            if (child.exitCode !== null) {
                this.sessions.delete(name);
                throw new Error(`Blender headless worker exited during startup (code ${child.exitCode}).\n${session.stderr.slice(-4000)}`);
            }
            if (await session.client.ping(800)) {
                session.ready = true;
                if (options.engine) {
                    await session.client.call("set_render_settings", { engine: options.engine }, { timeoutMs: 30_000 }).catch(() => undefined);
                }
                return { name, port, pid: child.pid, state: "started", blender };
            }
            await sleep(350);
        }
        await this.stop(name);
        throw new Error(`Blender worker did not become ready within the timeout. Is "${blender}" a valid Blender executable?\n` +
            session.stderr.slice(-3000));
    }
    queue(name, fn) {
        const previous = this.queues.get(name) ?? Promise.resolve();
        const next = previous.then(fn, fn);
        this.queues.set(name, next.catch(() => undefined));
        return next;
    }
    async exec(name, code, options = {}) {
        const session = await this.ensure(name, options.blender, options.signal);
        return this.queue(name, async () => {
            session.busy = true;
            try {
                const response = await session.client.call("execute_code", { ...(code ? { code } : {}), ...(options.file ? { file: options.file } : {}) }, { timeoutMs: options.timeoutMs ?? 120_000, signal: options.signal });
                return { session: name, ...response.result, ms: response.ms };
            }
            finally {
                session.busy = false;
                session.lastUsed = Date.now();
            }
        });
    }
    async see(name, options) {
        const session = await this.ensure(name, options.blender, options.signal);
        return this.queue(name, async () => {
            session.busy = true;
            try {
                const response = await session.client.call("render_view", {
                    max_size: options.max_size ?? 640,
                    filepath: options.filepath,
                    from: options.from,
                    look_at: options.look_at,
                    lens: options.lens,
                    ortho: options.ortho,
                    view_size: options.view_size,
                }, { timeoutMs: 120_000, signal: options.signal });
                return { session: name, ...response.result };
            }
            finally {
                session.busy = false;
                session.lastUsed = Date.now();
            }
        });
    }
    async reset(name, blender) {
        const result = await this.exec(name, "bpy.ops.wm.read_factory_settings(use_empty=True)\nresult = {'reset': True}\n", { blender, timeoutMs: 60_000 });
        return { name, ...result };
    }
    async status(name = "default", blender) {
        const session = await this.ensure(name, blender);
        try {
            const info = await session.client.info(5000);
            return { name, port: session.port, pid: session.pid, ready: true, info };
        }
        catch (error) {
            return { name, port: session.port, pid: session.pid, ready: false, error: error.message };
        }
    }
    async stop(name) {
        const session = this.sessions.get(name);
        this.sessions.delete(name);
        if (!session)
            return { name, stopped: false };
        const pid = session.pid;
        try {
            session.child.kill();
        }
        catch {
            // ignore
        }
        if (pid && process.platform === "win32") {
            await new Promise((resolve) => {
                execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
            });
        }
        await sleep(200);
        return { name, stopped: true, pid };
    }
    async stopAll() {
        clearInterval(this.reaper);
        const names = [...this.sessions.keys()];
        await Promise.all(names.map((name) => this.stop(name).catch(() => undefined)));
    }
    async ensure(name, blender, signal) {
        let session = this.sessions.get(name);
        if (session && session.child.exitCode === null && (await session.client.ping(1000))) {
            session.lastUsed = Date.now();
            return session;
        }
        if (session)
            await this.stop(name);
        await this.start({ name, blender, timeoutMs: 90_000 });
        session = this.sessions.get(name);
        if (!session)
            throw new BridgeError("unreachable", "Headless worker failed to start");
        if (signal?.aborted)
            throw new BridgeError("aborted", "Tool call was aborted");
        return session;
    }
    async reap() {
        for (const [name, session] of this.sessions) {
            if (session.busy)
                continue;
            if (Date.now() - session.lastUsed < this.options.ttlMs)
                continue;
            try {
                await this.stop(name);
            }
            catch {
                // ignore
            }
        }
    }
}
