"""Wrapper for one-shot ``blender -b`` runs started by the OpenCode plugin.

Configuration arrives as JSON in OCBB_HEADLESS_CONFIG so user code never has to
survive command-line quoting. The wrapper writes a machine-readable
``result.json`` next to its logs.
"""

import json
import os
import sys
import time
import traceback
from contextlib import redirect_stderr, redirect_stdout


def _write_result(path, payload):
    try:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, default=str)
    except Exception:
        pass


def main():
    config_path = os.environ.get("OCBB_HEADLESS_CONFIG", "")
    with open(config_path, "r", encoding="utf-8") as handle:
        cfg = json.load(handle)
    result_path = cfg["result_path"]
    started = time.time()
    stdout = ""
    stderr = ""
    payload = {"ok": False, "result": None, "stdout": "", "stderr": "", "error": None, "traceback": None, "files": []}
    try:
        import bpy

        addon_root = cfg.get("addon_path", "")
        if addon_root and addon_root not in sys.path:
            sys.path.insert(0, addon_root)

        if cfg.get("workdir"):
            os.chdir(cfg["workdir"])
            if cfg["workdir"] not in sys.path:
                sys.path.insert(0, cfg["workdir"])

        if cfg.get("file"):
            bpy.ops.wm.open_mainfile(filepath=cfg["file"])

        engine = str(cfg.get("engine") or "eevee").lower()
        if engine not in {"keep", "none", "default"}:
            wanted = {"eevee": ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"], "cycles": ["CYCLES"], "workbench": ["BLENDER_WORKBENCH"]}.get(engine, [engine.upper()])
            available = set()
            try:
                available = {item.identifier for item in bpy.context.scene.render.bl_rna.properties["engine"].enum_items}
            except Exception:
                pass
            for candidate in wanted:
                if not available or candidate in available:
                    bpy.context.scene.render.engine = candidate
                    break

        script = cfg["script"]
        with open(script, "r", encoding="utf-8") as handle:
            source = handle.read()

        from opencode_blender_bridge.commands.core import Kernel

        kernel = Kernel()
        kernel.out_dir = cfg.get("outdir") or ""
        kernel.args = list(cfg.get("args") or [])
        namespace = kernel.namespace
        namespace["__file__"] = script
        sys.argv = [script] + list(cfg.get("args") or [])

        out = sys.stdout
        err = sys.stderr
        buffer_out = []
        buffer_err = []

        class Tee:
            def __init__(self, original, buffer):
                self.original = original
                self.buffer = buffer

            def write(self, text):
                self.buffer.append(text)
                return self.original.write(text)

            def flush(self):
                return self.original.flush()

            def isatty(self):
                return False

        sys.stdout = Tee(out, buffer_out)
        sys.stderr = Tee(err, buffer_err)
        try:
            exec(compile(source, script, "exec"), namespace)
            payload["ok"] = True
        except SystemExit as exc:
            payload["ok"] = int(getattr(exc, "code", 0) or 0) == 0
            if not payload["ok"]:
                payload["error"] = "SystemExit: %s" % exc.code
                payload["traceback"] = traceback.format_exc()
        except Exception as exc:
            payload["error"] = "%s: %s" % (type(exc).__name__, exc)
            payload["traceback"] = traceback.format_exc()
        finally:
            sys.stdout = out
            sys.stderr = err
        stdout = "".join(buffer_out)[-40000:]
        stderr = "".join(buffer_err)[-20000:]
        result = namespace.get("result")
        if result is not None:
            try:
                json.dumps(result)
                payload["result"] = result
            except Exception:
                payload["result"] = repr(result)

        shots = cfg.get("shots") or []
        if shots:
            from opencode_blender_bridge.commands.screenshot import ScreenshotCommands

            screenshots = ScreenshotCommands()
            rendered = []
            for index, shot in enumerate(shots):
                shot = dict(shot or {})
                name = str(shot.pop("name", "shot_%02d" % index) or "shot_%02d" % index)
                target = os.path.join(cfg.get("outdir") or os.path.dirname(script), name + ".png")
                info = screenshots.render_view(
                    max_size=shot.get("max_size", 800),
                    filepath=target,
                    from_location=shot.get("from"),
                    look_at=shot.get("look_at"),
                    lens=shot.get("lens", 50),
                    ortho=shot.get("ortho", False),
                    view_size=shot.get("res") or shot.get("view_size"),
                )
                rendered.append({"name": name, "filepath": target, "info": info})
            payload["shots"] = rendered
    except Exception as exc:
        payload["error"] = "%s: %s" % (type(exc).__name__, exc)
        payload["traceback"] = traceback.format_exc()
    finally:
        payload["stdout"] = stdout
        payload["stderr"] = stderr
        payload["wall_ms"] = round((time.time() - started) * 1000)
        outdir = cfg.get("outdir") or ""
        if outdir and os.path.isdir(outdir):
            files = []
            for name in sorted(os.listdir(outdir)):
                full = os.path.join(outdir, name)
                if not os.path.isfile(full) or name == "result.json":
                    continue
                try:
                    files.append({"name": name, "path": full, "bytes": os.path.getsize(full)})
                except Exception:
                    pass
            payload["files"] = files
        _write_result(result_path, payload)
        try:
            print("HEADLESS " + json.dumps({k: payload.get(k) for k in ("ok", "error", "wall_ms")}, ensure_ascii=False), flush=True)
        except Exception:
            pass
        sys.stdout.flush()
        sys.stderr.flush()
        if cfg.get("hard_exit", True):
            os._exit(0 if payload.get("ok") else 1)
        raise SystemExit(0 if payload.get("ok") else 1)


if __name__ == "__main__":
    main()
