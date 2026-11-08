import type { Host } from "../host.js";
import { type ToolOutput } from "./common.js";
import { type HeadlessArgs } from "../headless.js";
declare function asArgs(input: Record<string, unknown>): HeadlessArgs;
export declare function headlessTool(host: Host): {
    name: string;
    description: string;
    input: Record<string, unknown>;
    execute(input: Record<string, unknown>): Promise<ToolOutput>;
};
export { asArgs };
