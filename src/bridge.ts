import net from "node:net"

export type BridgeErrorCode = "unreachable" | "timeout" | "addon_error" | "bad_response" | "aborted"

export class BridgeError extends Error {
  readonly code: BridgeErrorCode
  readonly detail?: unknown

  constructor(code: BridgeErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = "BridgeError"
    this.code = code
    this.detail = detail
  }
}

export interface BridgeResult<T> {
  result: T
  ms: number
}

export interface CallOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export class BridgeClient {
  constructor(
    readonly host: string,
    readonly port: number,
  ) {}

  async call<T = Record<string, unknown>>(
    type: string,
    params: Record<string, unknown> = {},
    options: CallOptions = {},
  ): Promise<BridgeResult<T>> {
    const timeoutMs = Math.max(250, options.timeoutMs ?? 120_000)
    const started = Date.now()
    return new Promise<BridgeResult<T>>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new BridgeError("aborted", "Tool call was aborted"))
        return
      }
      const socket = net.connect({ host: this.host, port: this.port })
      let buffer = ""
      let settled = false
      let timer: NodeJS.Timeout | undefined

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener("abort", onAbort)
        try {
          socket.destroy()
        } catch {
          // already closed
        }
        fn()
      }

      const onAbort = () => finish(() => reject(new BridgeError("aborted", "Tool call was aborted")))

      timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new BridgeError(
                "timeout",
                `Blender did not answer ${type} within ${timeoutMs} ms (port ${this.port})`,
              ),
            ),
          ),
        timeoutMs,
      )
      options.signal?.addEventListener("abort", onAbort, { once: true })

      socket.once("connect", () => {
        try {
          socket.write(JSON.stringify({ type, params }))
        } catch (error) {
          finish(() => reject(new BridgeError("unreachable", String(error))))
        }
      })

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8")
        let parsed: unknown
        try {
          parsed = JSON.parse(buffer)
        } catch {
          return
        }
        finish(() => {
          const record = parsed as Record<string, unknown>
          if (record.status === "error") {
            const message = String(record.message || record.error || "Blender add-on returned an error")
            reject(new BridgeError("addon_error", message, record))
            return
          }
          if (record.status !== "success") {
            reject(new BridgeError("bad_response", "Unexpected response from Blender: " + buffer.slice(0, 500)))
            return
          }
          resolve({ result: (record.result ?? {}) as T, ms: Date.now() - started })
        })
      })

      socket.once("error", (error: NodeJS.ErrnoException) => {
        const code = error.code === "ECONNREFUSED" || error.code === "EHOSTUNREACH" ? "unreachable" : "unreachable"
        finish(() =>
          reject(
            new BridgeError(
              code,
              `No Blender bridge on ${this.host}:${this.port} (${error.code || error.message}). ` +
                `Start Blender, open the OpenCode sidebar panel and press Connect.`,
            ),
          ),
        )
      })

      socket.once("close", () => {
        if (!settled && !buffer) {
          finish(() => reject(new BridgeError("bad_response", "Blender closed the connection without a response")))
        }
      })
    })
  }

  async ping(timeoutMs = 1500): Promise<boolean> {
    try {
      await this.call("ping", {}, { timeoutMs })
      return true
    } catch {
      return false
    }
  }

  async info(timeoutMs = 4000): Promise<Record<string, unknown>> {
    const { result } = await this.call<Record<string, unknown>>("get_addon_info", {}, { timeoutMs })
    return result
  }
}
