"""Socket server and command dispatch.

The socket runs on a background thread; every bpy call is queued and executed
on Blender's main thread. In GUI mode a bpy timer drains the queue. In
background mode (``blender -b``) nobody runs timers, so the worker entry point
calls :meth:`BridgeServer.run_forever`, which drains the queue itself.
"""

import json
import queue
import socket
import threading
import time
import traceback

import bpy

from .commands import COMMAND_NAMES, BridgeCommands
from .protocol import ai_paused, is_pause_safe_command

SERVER = None


class BridgeServer(BridgeCommands):
    def __init__(self, host="127.0.0.1", port=9876, background=None):
        super().__init__()
        self.host = str(host)
        self.port = int(port or 9876)
        self.background = bool(bpy.app.background if background is None else background)
        self.running = False
        self.socket = None
        self.server_thread = None
        self.command_queue = queue.Queue()
        self._clients = set()
        self._clients_lock = threading.Lock()
        self._started_at = None

    # ---------------------------------------------------------------- lifecycle
    def start(self, background=None):
        if background is not None:
            self.background = bool(background)
        if self.running:
            return {"running": True, "host": self.host, "port": self.port}
        try:
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.socket.bind((self.host, self.port))
            self.port = int(self.socket.getsockname()[1])
            self.socket.listen(8)
            self.socket.settimeout(1.0)
        except Exception as exc:
            try:
                if self.socket:
                    self.socket.close()
            except Exception:
                pass
            self.socket = None
            print("[OpenCode Bridge] failed to bind %s:%s: %s" % (self.host, self.port, exc), flush=True)
            return {"running": False, "error": str(exc)}

        self.running = True
        self._started_at = time.time()
        self.server_thread = threading.Thread(target=self._server_loop, name="ocbb-server", daemon=True)
        self.server_thread.start()
        if not self.background:
            try:
                if not bpy.app.timers.is_registered(self._drain_timer):
                    bpy.app.timers.register(self._drain_timer, persistent=True)
            except Exception:
                pass
        print("[OpenCode Bridge] listening on %s:%d (background=%s)" % (self.host, self.port, self.background), flush=True)
        return {"running": True, "host": self.host, "port": self.port, "background": self.background}

    def stop(self):
        self.running = False
        try:
            if not self.background and bpy.app.timers.is_registered(self._drain_timer):
                bpy.app.timers.unregister(self._drain_timer)
        except Exception:
            pass
        with self._clients_lock:
            clients = list(self._clients)
            self._clients.clear()
        for client in clients:
            try:
                client.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                client.close()
            except Exception:
                pass
        if self.socket:
            try:
                self.socket.close()
            except Exception:
                pass
            self.socket = None
        while True:
            try:
                self.command_queue.get_nowait()
            except queue.Empty:
                break
        if self.server_thread and self.server_thread.is_alive():
            try:
                self.server_thread.join(timeout=1.0)
            except Exception:
                pass
        self.server_thread = None
        print("[OpenCode Bridge] server stopped", flush=True)
        return {"running": False}

    # ------------------------------------------------------------------- threads
    def _server_loop(self):
        while self.running:
            try:
                try:
                    client, address = self.socket.accept()
                except socket.timeout:
                    continue
                except Exception as exc:
                    if not self.running:
                        break
                    print("[OpenCode Bridge] accept error: %s" % exc, flush=True)
                    time.sleep(0.2)
                    continue
                thread = threading.Thread(target=self._handle_client, args=(client, address), daemon=True)
                thread.start()
            except Exception as exc:
                if not self.running:
                    break
                print("[OpenCode Bridge] server loop error: %s" % exc, flush=True)
                time.sleep(0.2)

    def _handle_client(self, client, address=None):
        client.settimeout(1.0)
        with self._clients_lock:
            self._clients.add(client)
        buffer = b""
        try:
            while self.running:
                try:
                    data = client.recv(65536)
                except socket.timeout:
                    continue
                except Exception:
                    break
                if not data:
                    break
                buffer += data
                while True:
                    try:
                        command = json.loads(buffer.decode("utf-8"))
                        buffer = b""
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        break
                    if not isinstance(command, dict):
                        client.sendall(json.dumps({"status": "error", "message": "command must be a JSON object"}).encode("utf-8"))
                        continue
                    self.command_queue.put((command, client))
        finally:
            with self._clients_lock:
                self._clients.discard(client)
            try:
                client.close()
            except Exception:
                pass

    # -------------------------------------------------------------------- dispatch
    def _drain_timer(self):
        if not self.running:
            return None
        self.drain()
        return 0.05

    def drain(self):
        while True:
            try:
                command, client = self.command_queue.get_nowait()
            except queue.Empty:
                break
            try:
                response = self.execute_command(command)
            except Exception as exc:
                traceback.print_exc()
                response = {"status": "error", "message": str(exc)}
            try:
                payload = json.dumps(response, ensure_ascii=False, default=str)
            except Exception as exc:
                payload = json.dumps({"status": "error", "message": "response not serializable: %s" % exc})
            try:
                client.sendall(payload.encode("utf-8"))
            except Exception:
                pass

    def run_forever(self, poll=0.02):
        """Drain commands on the current (main) thread; used by ``blender -b``."""
        print("[OpenCode Bridge] worker main loop started", flush=True)
        try:
            while self.running:
                try:
                    self.drain()
                except Exception:
                    traceback.print_exc()
                time.sleep(poll)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()

    def execute_command(self, command):
        cmd_type = str(command.get("type") or "")
        params = command.get("params") or {}
        if not isinstance(params, dict):
            return {"status": "error", "message": "params must be an object"}
        if "from" in params:
            params = dict(params)
            params["from_location"] = params.pop("from")
        if cmd_type not in COMMAND_NAMES:
            return {"status": "error", "message": "Unknown command type: %s" % cmd_type}
        if ai_paused() and not is_pause_safe_command(cmd_type):
            return {
                "status": "error",
                "error": "AI_PAUSED",
                "message": "AI operations are paused in Blender. Click 'Resume AI' in the OpenCode panel.",
            }
        handler = getattr(self, cmd_type, None)
        if not callable(handler):
            return {"status": "error", "message": "Unhandled command: %s" % cmd_type}
        try:
            result = handler(**params)
            if not isinstance(result, dict):
                result = {"value": result}
            return {"status": "success", "result": result}
        except TypeError as exc:
            return {"status": "error", "message": "Bad parameters for %s: %s" % (cmd_type, exc)}
        except Exception as exc:
            print("[OpenCode Bridge] %s failed: %s" % (cmd_type, exc), flush=True)
            traceback.print_exc()
            return {"status": "error", "message": str(exc)}


def start_server(port=9876, background=None):
    global SERVER
    if SERVER and SERVER.running:
        return {"running": True, "host": SERVER.host, "port": SERVER.port}
    SERVER = BridgeServer(port=port, background=background)
    return SERVER.start()


def stop_server():
    global SERVER
    if SERVER:
        result = SERVER.stop()
        SERVER = None
        return result
    return {"running": False}


def get_server():
    return SERVER
