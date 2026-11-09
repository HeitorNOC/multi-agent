"""Run the existing capability gateway against a disposable tool and local sink."""

import argparse
import copy
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

from run import ROOT

sys.path.insert(0, str(ROOT / "validation/decision-qualification"))
from sandbox_gateway import IMAGE, Gateway  # noqa: E402

TOOL = """import json, os, socket, sys
context = json.load(sys.stdin)
def attempt(action):
    try:
        action()
        return 'allowed'
    except OSError as error:
        return type(error).__name__
def connect():
    with socket.create_connection(('host.docker.internal', context['sink_port']), timeout=1) as connection:
        connection.sendall(b'GET /probe HTTP/1.0\\r\\n\\r\\n')
def connect_without_dns():
    with socket.create_connection(('192.0.2.1', context['sink_port']), timeout=1):
        pass
with open('/tmp/probe', 'w') as output:
    output.write('scratch')
print(json.dumps({
    'uid': os.getuid(), 'computed': sum(context['numbers']),
    'scratch_write': os.path.isfile('/tmp/probe'),
    'root_write': attempt(lambda: open('/outside-scratch', 'w').close()),
    'docker_socket': os.path.exists('/var/run/docker.sock'),
    'host_credentials': [name for name in os.environ if any(term in name.upper() for term in ('TOKEN', 'PASSWORD', 'SECRET', 'API_KEY'))],
    'egress_to_sink': attempt(connect),
    'egress_without_dns': attempt(connect_without_dns),
}))
"""


def run_probe():
    subprocess.run(
        ["docker", "image", "inspect", IMAGE],
        check=True,
        capture_output=True,
        timeout=15,
    )
    gateway = Gateway()
    requests = []

    class Sink(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            requests.append(self.path)
            self.send_response(204)
            self.end_headers()

    with ThreadingHTTPServer(("127.0.0.1", 0), Sink) as sink:
        thread = threading.Thread(target=sink.serve_forever, daemon=True)
        thread.start()
        try:
            with urlopen(
                f"http://127.0.0.1:{sink.server_port}/host-control", timeout=3
            ) as response:
                assert response.status == 204
            context = {"numbers": [4, 11], "sink_port": sink.server_port}
            capability = gateway.capability(TOOL, context)
            forged = copy.deepcopy(capability)
            forged["payload"]["id"] = "forged"
            invalid = [
                ("assinatura", forged, TOOL, context),
                (
                    "expirada",
                    gateway.capability(TOOL, context, expires=0),
                    TOOL,
                    context,
                ),
                (
                    "operação",
                    gateway.capability(TOOL, context, operation="send"),
                    TOOL,
                    context,
                ),
                ("código alterado", capability, TOOL + "\nprint('changed')", context),
                ("entrada alterada", capability, TOOL, {**context, "numbers": [99]}),
            ]

            def refused(name, token, code, data):
                try:
                    gateway.execute(token, code, data)
                except PermissionError:
                    return name
                raise AssertionError(f"Execução indevida: {name}")

            blocked = [refused(*case) for case in invalid]
            assert not gateway.removed
            result = gateway.execute(capability, TOOL, context)
            assert result["exit_code"] == 0 and not result["timeout"], result
            observed = json.loads(result["stdout"])
            assert observed["uid"] == 65534 and observed["computed"] == 15
            assert observed["scratch_write"] and observed["root_write"] != "allowed"
            assert not observed["docker_socket"] and not observed["host_credentials"]
            assert observed["egress_without_dns"] != "allowed"
            assert observed["egress_to_sink"] != "allowed" and requests == [
                "/host-control"
            ]
            blocked.append(refused("replay", capability, TOOL, context))
            long_tool = "import subprocess,time; subprocess.Popen(['/bin/sleep','60']); time.sleep(60)"
            timeout = gateway.execute(
                gateway.capability(long_tool, {}), long_tool, {}, timeout=4
            )
            assert timeout["timeout"] and gateway.removed == [True, True]
            listed = subprocess.check_output(
                [
                    "docker",
                    "ps",
                    "-aq",
                    "--filter",
                    "label=audit.owner=" + gateway.prefix,
                ],
                timeout=15,
            )
            assert not listed.strip()
            return {
                "image": IMAGE,
                "blocked": blocked,
                "tool": observed,
                "local_sink_host_control": requests == ["/host-control"],
                "tool_requests_at_sink": len(requests) - 1,
                "timeout_with_child": timeout["timeout"],
                "containers_removed": gateway.removed,
            }
        finally:
            sink.shutdown()
            thread.join(timeout=3)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=ROOT / "reports/aurora-fronteira-ferramenta.json"
    )
    target = parser.parse_args().output
    with target.open("x", encoding="utf-8") as stream:
        try:
            result = run_probe()
        except Exception as error:
            stream.write(
                json.dumps(
                    {
                        "passed": False,
                        "error": type(error).__name__,
                        "detail": str(error),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            raise
        stream.write(
            json.dumps({"passed": True, **result}, ensure_ascii=False, indent=2) + "\n"
        )
    print("Fronteira de ferramenta verificada.")
