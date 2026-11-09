"""Controlled worker for the reference/effect ordering regression."""

import json
import os
import sys
from urllib.request import Request, urlopen


def main():
    config = json.load(sys.stdin)

    def call(path, **fields):
        data = json.dumps(
            {"job": config["job"], "model_lease": config["model_lease"], **fields}
        ).encode()
        request = Request(
            config["api"] + "/internal/" + path,
            data,
            {
                "content-type": "application/json",
                "x-demo-token": config["token"],
            },
        )
        with urlopen(request, timeout=15) as response:
            return json.load(response)

    job = call("snapshot")
    if not job["review"]:
        call("review", report={"fixture_goal": config["goal"]})
    if not job["approval"]:
        print(json.dumps({"completed": False}))
        return
    receipt = call("effect", hash=job["review"]["hash"])
    if "queda" in config["goal"] and not job["receipt"]:
        os._exit(88)
    print(json.dumps({"completed": True, "receipt": receipt["id"]}))


if __name__ == "__main__":
    main()
