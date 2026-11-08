import type { Host } from "../host.js";
export interface FilePart {
    type: "file";
    uri: string;
    mime: string;
    name?: string;
}
export interface ToolOutput {
    content: string | Array<{
        type: "text";
        text: string;
    } | FilePart>;
    metadata?: Record<string, unknown>;
}
export declare function textResult(text: string, metadata?: Record<string, unknown>): ToolOutput;
export declare function errorResult(message: string, hint?: string): ToolOutput;
export declare function mimeFor(file: string): string;
export declare function frameResult(host: Host, key: string, file: string, summary: string, force?: boolean): ToolOutput;
export declare function bridgeHint(error: unknown): string | undefined;
export declare function guarded(fn: () => Promise<ToolOutput>): Promise<ToolOutput>;
export declare function str(value: unknown, fallback?: string): string;
export declare function num(value: unknown, fallback: number): number;
export declare function bool(value: unknown, fallback?: boolean): boolean;
export declare function argsObject(value: unknown): Record<string, unknown>;
export declare const objectSchema: (properties: Record<string, unknown>, required?: string[]) => Record<string, unknown>;
