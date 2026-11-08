import { seeTool } from "./see.js";
import { doTool } from "./do.js";
import { watchTool } from "./watch.js";
import { workerTool } from "./worker.js";
import { planTool } from "./plan.js";
import { viewportTool } from "./viewport.js";
import { headlessTool } from "./headless.js";
import { jobTool } from "./job.js";
import { loopTool } from "./loop.js";
import { txnTool } from "./txn.js";
import { presetTool } from "./preset.js";
import { perfTool, optTool } from "./perf.js";
import { cmdTool, commandsTool } from "./cmd.js";
import { cadTool } from "./cad.js";
export function buildTools(host) {
    return [
        seeTool(host),
        doTool(host),
        watchTool(host),
        workerTool(host),
        planTool(host),
        viewportTool(host),
        headlessTool(host),
        jobTool(host),
        loopTool(host),
        txnTool(host),
        presetTool(host),
        perfTool(host),
        optTool(host),
        cmdTool(host),
        commandsTool(host),
        cadTool(host),
    ];
}
