import fs from "node:fs";
import { errorResult, guarded, num, objectSchema, str, textResult } from "./common.js";
import { asArgs } from "./headless.js";
import { jsonText } from "../util.js";
export function jobTool(host) {
    return {
        name: "blender_rt_job",
        description: "Background jobs for long Blender work: start a headless run, then collect it by id. A timeout does not lose the result. " +
            "Use it for renders, batch validation and parameter sweeps instead of holding a tool call open. " +
            "status/result/wait/cancel/list work on the same job registry.",
        input: objectSchema({
            op: { type: "string", description: "start | status | result | wait | cancel | list" },
            id: { type: "string", description: "Job id." },
            wait_s: { type: "number", description: "Seconds to wait for a result. Default 0 for start, 30 for wait/result." },
            label: { type: "string", description: "Short job label for start." },
            script: { type: "string", description: "Python source (start)." },
            script_file: { type: "string", description: "Python file (start)." },
            file: { type: "string", description: ".blend file to open." },
            outdir: { type: "string", description: "Output directory." },
            timeout_ms: { type: "integer", description: "Process timeout." },
            engine: { type: "string", description: "eevee | cycles | workbench | keep | none." },
            args: { type: "string", description: "Extra command-line arguments." },
            workdir: { type: "string", description: "Working directory." },
            shots: { type: "array", description: "Camera angles to render." },
            env: { type: "object", description: "Extra environment variables." },
        }, ["op"]),
        async execute(input) {
            return guarded(async () => {
                const op = str(input.op, "status").toLowerCase();
                if (op === "list")
                    return textResult(jsonText(host.jobs.list(), 6000));
                if (op === "start") {
                    const job = host.jobs.start(asArgs(input), str(input.label) || "job");
                    const wait = num(input.wait_s, 0);
                    if (wait > 0)
                        await host.jobs.wait(job.id, wait);
                    const latest = host.jobs.get(job.id);
                    return textResult(`job ${job.id} · ${latest?.status}\nrun: ${job.runDir}\n\nCollect with blender_rt_job(op="status", id="${job.id}").`, { jobId: job.id, status: latest?.status });
                }
                const id = str(input.id);
                if (!id)
                    return errorResult("blender_rt_job needs id (except op=list/start)", "Use blender_rt_job(op=\"list\") to see job ids.");
                if (op === "cancel") {
                    const job = await host.jobs.cancel(id);
                    return job ? textResult(host.jobs.summary(job)) : errorResult("Job not found: " + id);
                }
                if (op === "status") {
                    const job = host.jobs.get(id);
                    return job ? textResult(host.jobs.summary(job)) : errorResult("Job not found: " + id);
                }
                if (op === "wait" || op === "result") {
                    const job = await host.jobs.wait(id, num(input.wait_s, 30));
                    if (!job)
                        return errorResult("Job not found: " + id);
                    const lines = [host.jobs.summary(job)];
                    if (job.status === "running")
                        lines.push("Still running; call again with wait_s or op=status.");
                    if (job.status !== "running" && fs.existsSync(job.resultPath)) {
                        try {
                            const payload = JSON.parse(fs.readFileSync(job.resultPath, "utf8"));
                            if (payload.result !== undefined && payload.result !== null)
                                lines.push("result: " + jsonText(payload.result, 4000));
                            if (Array.isArray(payload.files) && payload.files.length)
                                lines.push("files: " + payload.files.map((file) => String(file.path)).join(", "));
                        }
                        catch {
                            // result file unreadable
                        }
                    }
                    return textResult(lines.join("\n"), { jobId: id, status: job.status });
                }
                return errorResult("Unknown op: " + op, "op is start | status | result | wait | cancel | list");
            });
        },
    };
}
