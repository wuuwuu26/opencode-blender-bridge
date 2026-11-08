import fs from "node:fs";
import path from "node:path";
import { startHeadless } from "./headless.js";
import { ensureDir, safeName, sleep, stamp, writeJson } from "./util.js";
export class JobManager {
    host;
    jobs = new Map();
    constructor(host) {
        this.host = host;
        ensureDir(path.join(host.dataDir, "jobs"));
    }
    start(args, label) {
        const blenderPath = this.host.blenderPath();
        if (!blenderPath)
            throw new Error("Blender executable not found. Set blenderPath in plugin options or OCBB_BLENDER.");
        const id = stamp() + "-" + safeName(label || path.basename(args.script_file || "job"), "job") + "-" + Math.random().toString(36).slice(2, 6);
        const handle = startHeadless({ blenderPath, dataDir: this.host.dataDir }, args, { runId: id });
        const record = {
            id,
            status: "running",
            startedAt: Date.now(),
            runDir: handle.runDir,
            resultPath: handle.resultPath,
            stdoutPath: handle.stdoutPath,
            stderrPath: handle.stderrPath,
            pid: handle.child.pid,
            args,
            handle,
        };
        this.jobs.set(id, record);
        this.persist(record);
        record.promise = handle.done.then((result) => {
            record.result = result;
            record.exitCode = result.exitCode;
            record.finishedAt = Date.now();
            record.status = result.timedOut ? "timeout" : result.ok ? "done" : "failed";
            record.error = result.payload.error || undefined;
            this.persist(record);
            return result;
        });
        return record;
    }
    get(id) {
        return this.jobs.get(id);
    }
    list() {
        return [...this.jobs.values()]
            .sort((a, b) => b.startedAt - a.startedAt)
            .map((job) => ({
            id: job.id,
            status: job.status,
            started_at: new Date(job.startedAt).toISOString(),
            finished_at: job.finishedAt ? new Date(job.finishedAt).toISOString() : undefined,
            exit_code: job.exitCode,
            error: job.error,
            run_dir: job.runDir,
        }));
    }
    async wait(id, seconds) {
        const job = this.jobs.get(id);
        if (!job)
            return undefined;
        if (job.promise && job.status === "running") {
            await Promise.race([job.promise, sleep(Math.max(0, seconds) * 1000)]);
        }
        return job;
    }
    async cancel(id) {
        const job = this.jobs.get(id);
        if (!job?.handle)
            return job;
        job.status = "cancelled";
        try {
            job.handle.child.kill();
            if (job.handle.child.pid && process.platform === "win32") {
                const { execFile } = await import("node:child_process");
                await new Promise((resolve) => {
                    execFile("taskkill", ["/pid", String(job.handle?.child.pid), "/T", "/F"], { windowsHide: true }, () => resolve());
                });
            }
        }
        catch {
            // already exited
        }
        job.finishedAt = Date.now();
        this.persist(job);
        return job;
    }
    summary(job) {
        const lines = [
            `job ${job.id}`,
            `status ${job.status}` + (job.exitCode !== undefined ? ` · exit ${job.exitCode}` : ""),
        ];
        if (job.error)
            lines.push("error: " + job.error);
        const payload = job.result?.payload;
        if (payload?.stdout)
            lines.push("stdout:\n" + payload.stdout.slice(-3000));
        if (payload?.stderr)
            lines.push("stderr:\n" + payload.stderr.slice(-2000));
        if (payload?.result !== undefined && payload.result !== null)
            lines.push("result: " + JSON.stringify(payload.result).slice(0, 3000));
        if (payload?.files?.length)
            lines.push("files: " + payload.files.map((file) => file.path).join(", "));
        lines.push("run: " + job.runDir);
        return lines.join("\n");
    }
    async shutdown() {
        const running = [...this.jobs.values()].filter((job) => job.status === "running");
        await Promise.all(running.map((job) => this.cancel(job.id).catch(() => undefined)));
    }
    async cancelAll() {
        const running = [...this.jobs.values()].filter((job) => job.status === "running");
        await Promise.all(running.map((job) => this.cancel(job.id).catch(() => undefined)));
    }
    persist(job) {
        try {
            const dir = ensureDir(path.join(this.host.dataDir, "jobs", job.id));
            writeJson(path.join(dir, "job.json"), {
                id: job.id,
                status: job.status,
                startedAt: job.startedAt,
                finishedAt: job.finishedAt,
                exitCode: job.exitCode,
                error: job.error,
                runDir: job.runDir,
                args: job.args,
            });
            fs.writeFileSync(path.join(dir, "README.txt"), `OpenCode Blender job ${job.id}\nstatus: ${job.status}\nlogs: ${job.stdoutPath}\n`, "utf8");
        }
        catch {
            // persistence is best-effort
        }
    }
}
