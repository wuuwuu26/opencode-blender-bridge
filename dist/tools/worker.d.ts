import type { Host } from "../host.js";
import { type ToolOutput } from "./common.js";
export declare function workerTool(host: Host): {
    name: string;
    description: string;
    input: Record<string, unknown>;
    execute(input: Record<string, unknown>): Promise<ToolOutput>;
};
