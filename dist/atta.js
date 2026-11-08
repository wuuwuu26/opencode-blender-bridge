import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, jsonText, lookPath, safeName, stamp, truncate } from "./util.js";
const DEFAULT_TIMEOUTS = {
    atta_doctor: 60_000,
    atta_catalog: 60_000,
    atta_spec: 60_000,
    atta_model: 180_000,
    atta_variant: 300_000,
    atta_describe: 120_000,
    atta_verify: 120_000,
    atta_preview: 600_000,
    atta_deliver: 600_000,
    atta_run: 900_000,
};
function venvPython(venv) {
    return process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}
export class AttaBridge {
    host;
    cached;
    lastError;
    constructor(host) {
        this.host = host;
    }
    get home() {
        return this.host.config.attaHome || path.join(this.host.projectDir, ".opencode", "atta");
    }
    get venvDir() {
        return path.join(this.host.projectDir, ".opencode", "atta-venv");
    }
    candidates() {
        const out = [];
        const add = (value) => {
            if (value && !out.includes(value))
                out.push(value);
        };
        add(this.host.config.attaPython);
        for (const venv of [
            this.venvDir,
            path.join(this.host.projectDir, ".venv-atta"),
            path.join(this.host.projectDir, ".venv"),
        ]) {
            add(venvPython(venv));
        }
        add(lookPath("python3"));
        add(lookPath("python"));
        return out;
    }
    detect(force = false) {
        if (this.cached && !force)
            return this.cached;
        this.lastError = undefined;
        for (const python of this.candidates()) {
            if (!python)
                continue;
            try {
                const output = execFileSync(python, ["-c", "import atta, sys; print(atta.__version__); print(sys.executable)"], {
                    timeout: 20_000,
                    encoding: "utf8",
                    windowsHide: true,
                    env: this.env(),
                }).trim();
                const [version, executable] = output.split(/\r?\n/);
                if (!version)
                    continue;
                this.cached = { python: executable || python, version, source: executable || python };
                return this.cached;
            }
            catch (error) {
                this.lastError = error instanceof Error ? error.message : String(error);
            }
        }
        return undefined;
    }
    status(force = false) {
        const location = this.detect(force);
        const blender = this.host.blenderPath();
        return {
            available: Boolean(location),
            python: location?.python,
            version: location?.version,
            source: location?.source,
            home: this.home,
            blender,
            repo: this.host.config.attaRepo,
            error: location
                ? undefined
                : this.lastError ||
                    "Atta is not importable from any candidate Python. Run blender_rt_cad(op=\"setup\") or install it manually.",
        };
    }
    env() {
        const env = {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            PYTHONUTF8: "1",
            ATTA_HOME: this.home,
        };
        const blender = this.host.blenderPath();
        if (blender)
            env.ATTA_BLENDER = blender;
        if (this.host.config.attaRoot)
            env.ATTA_ROOT = this.host.config.attaRoot;
        return env;
    }
    async call(tool, args = {}, options = {}) {
        const location = this.detect();
        if (!location) {
            throw new Error(this.lastError
                ? `Atta is not installed for any candidate Python (${this.lastError}).`
                : "Atta is not installed. Run blender_rt_cad(op=\"setup\") first.");
        }
        ensureDir(this.home);
        const tempDir = ensureDir(path.join(this.home, "tmp"));
        const argsFile = path.join(tempDir, `${safeName(tool)}-${stamp()}-${Math.random().toString(36).slice(2, 6)}.json`);
        fs.writeFileSync(argsFile, JSON.stringify(args), "utf8");
        const timeoutMs = Math.max(5_000, options.timeoutMs ?? DEFAULT_TIMEOUTS[tool] ?? 180_000);
        try {
            const run = await runProcess(location.python, ["-m", "atta", "tool", tool, "--args-file", argsFile], {
                cwd: this.host.projectDir,
                env: this.env(),
                timeoutMs,
                signal: options.signal,
                maxBytes: 30 * 1024 * 1024,
            });
            const text = run.stdout.trim();
            if (!text) {
                throw new Error(`Atta returned no output (exit ${run.code}${run.timedOut ? ", timed out" : ""}).\n${truncate(run.stderr.trim(), 4000)}`);
            }
            const start = text.indexOf("{");
            const end = text.lastIndexOf("}");
            const json = start >= 0 && end > start ? text.slice(start, end + 1) : text;
            try {
                const envelope = JSON.parse(json);
                return { ...envelope, ms: envelope.ms ?? run.ms };
            }
            catch {
                throw new Error(`Atta returned non-JSON output:\n${truncate(text, 4000)}`);
            }
        }
        finally {
            try {
                fs.unlinkSync(argsFile);
            }
            catch {
                // best effort
            }
        }
    }
    async setup(input = {}) {
        const base = input.python || lookPath("python3") || lookPath("python");
        if (!base) {
            throw new Error("No system Python found. Install Python 3.10+ and retry, or pass python=<path>.");
        }
        const venv = this.venvDir;
        if (input.reset && fs.existsSync(venv))
            fs.rmSync(venv, { recursive: true, force: true });
        ensureDir(path.dirname(venv));
        const log = [];
        const timeoutMs = Math.max(60_000, input.timeoutMs ?? 900_000);
        if (!fs.existsSync(venvPython(venv))) {
            const create = await runProcess(base, ["-m", "venv", venv], {
                cwd: this.host.projectDir,
                env: this.env(),
                timeoutMs: Math.min(timeoutMs, 180_000),
                maxBytes: 4 * 1024 * 1024,
            });
            log.push(create.stdout, create.stderr);
            if (create.code !== 0) {
                throw new Error(`python -m venv failed (exit ${create.code}).\n${truncate(create.stderr || create.stdout, 4000)}`);
            }
        }
        const source = input.source || this.host.config.attaRepo;
        const install = await runProcess(venvPython(venv), ["-m", "pip", "install", "--disable-pip-version-check", source], {
            cwd: this.host.projectDir,
            env: this.env(),
            timeoutMs,
            maxBytes: 8 * 1024 * 1024,
        });
        log.push(install.stdout, install.stderr);
        this.cached = undefined;
        const location = this.detect(true);
        if (install.code !== 0 || !location) {
            throw new Error(`Atta install failed (exit ${install.code}).\n${truncate(log.filter(Boolean).join("\n"), 6000)}`);
        }
        return {
            installed: true,
            python: location.python,
            version: location.version,
            venv,
            source,
            tail: truncate(log.filter(Boolean).join("\n").trim(), 3000),
        };
    }
    images(data, max = 3) {
        const found = [];
        const seen = new Set();
        const roots = [this.host.projectDir, this.home, this.host.config.attaRoot || ""];
        const resolve = (raw) => {
            if (typeof raw !== "string" || !raw)
                return undefined;
            if (path.isAbsolute(raw))
                return raw;
            for (const root of roots) {
                if (!root)
                    continue;
                const candidate = path.resolve(root, raw);
                if (fs.existsSync(candidate))
                    return candidate;
            }
            return path.resolve(this.host.projectDir, raw);
        };
        const walk = (value) => {
            if (found.length >= max)
                return;
            if (Array.isArray(value)) {
                for (const item of value)
                    walk(item);
                return;
            }
            if (!value || typeof value !== "object")
                return;
            const record = value;
            if (Array.isArray(record.images)) {
                for (const item of record.images) {
                    if (!item || typeof item !== "object")
                        continue;
                    const image = item;
                    const file = resolve(image.abs_path || image.path || image.file);
                    if (file && fs.existsSync(file) && file.toLowerCase().endsWith(".png") && !seen.has(file)) {
                        seen.add(file);
                        found.push(file);
                        if (found.length >= max)
                            return;
                    }
                }
            }
            for (const item of Object.values(record))
                walk(item);
        };
        walk(data);
        return found;
    }
    deliverFiles(data, extensions = [".glb", ".obj", ".stl", ".blend", ".step"]) {
        const found = [];
        const seen = new Set();
        const roots = [this.host.projectDir, this.home];
        const resolve = (raw) => {
            if (typeof raw !== "string" || !raw)
                return undefined;
            if (path.isAbsolute(raw))
                return raw;
            for (const root of roots) {
                const candidate = path.resolve(root, raw);
                if (fs.existsSync(candidate))
                    return candidate;
            }
            return path.resolve(this.host.projectDir, raw);
        };
        const walk = (value) => {
            if (Array.isArray(value)) {
                for (const item of value)
                    walk(item);
                return;
            }
            if (!value || typeof value !== "object")
                return;
            const record = value;
            for (const key of ["path", "file", "abs_path"]) {
                const file = resolve(record[key]);
                if (file && fs.existsSync(file) && extensions.some((ext) => file.toLowerCase().endsWith(ext)) && !seen.has(file)) {
                    seen.add(file);
                    found.push(file);
                }
            }
            for (const item of Object.values(record))
                walk(item);
        };
        walk(data);
        return found;
    }
}
function runProcess(command, args, options) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let settled = false;
        const kill = () => {
            if (!child.pid)
                return;
            if (process.platform === "win32") {
                try {
                    execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
                }
                catch {
                    child.kill();
                }
            }
            else {
                try {
                    process.kill(-child.pid, "SIGKILL");
                }
                catch {
                    child.kill("SIGKILL");
                }
            }
        };
        const timer = setTimeout(() => {
            timedOut = true;
            kill();
        }, options.timeoutMs);
        timer.unref?.();
        const onAbort = () => {
            timedOut = true;
            kill();
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
            if (stdout.length > options.maxBytes)
                stdout = stdout.slice(-options.maxBytes);
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
            if (stderr.length > options.maxBytes)
                stderr = stderr.slice(-options.maxBytes);
        });
        child.once("error", (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", onAbort);
            reject(error);
        });
        child.once("exit", (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", onAbort);
            resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
        });
    });
}
export function formatAttaEnvelope(envelope, maxChars = 8000) {
    if (!envelope.ok) {
        const error = envelope.error || {};
        const lines = [`ERROR ${error.code || "atta_error"}: ${error.message || "Atta failed"}`];
        if (error.path)
            lines.push(`path: ${String(error.path)}`);
        if (error.fix)
            lines.push(`fix: ${String(error.fix)}`);
        return lines.join("\n");
    }
    const data = envelope.data;
    const lines = [`${envelope.tool || "atta"} ok · ${envelope.ms ?? 0} ms`];
    if (data && typeof data === "object") {
        const record = data;
        for (const key of ["one_line", "status", "verdict", "model_id", "next"]) {
            const value = record[key];
            if (value !== undefined && value !== null && value !== "")
                lines.push(`${key}: ${String(value)}`);
        }
        const perception = record.perception;
        if (perception?.text) {
            lines.push("");
            lines.push(String(perception.text));
            const views = perception.views;
            if (views) {
                for (const [name, view] of Object.entries(views)) {
                    lines.push("");
                    lines.push(`[${name}] coverage=${Number(view.coverage ?? 0).toFixed(3)}  # solid, . empty`);
                    const rows = Array.isArray(view.ascii) ? view.ascii : [];
                    for (const row of rows)
                        lines.push(String(row));
                }
            }
        }
    }
    lines.push("");
    lines.push(jsonText(data, maxChars));
    return lines.join("\n");
}
