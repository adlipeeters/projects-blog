"""Ask one question as a demo account and stream the answer: make ask AS=alderline-hr Q="..." """

import json
import os
import sys

import httpx

from session import access_token


def main() -> int:
    username, question = sys.argv[1], sys.argv[2]
    headers = {"Authorization": f"Bearer {access_token(username)}"}
    with httpx.stream(
        "POST",
        f"{os.environ['API_URL']}/api/chat",
        headers=headers,
        json={"question": question},
        timeout=90,
    ) as response:
        if response.status_code != 200:
            print(f"HTTP {response.status_code}")
            return 1
        name = ""
        for line in response.iter_lines():
            if line.startswith("event: "):
                name = line.removeprefix("event: ")
            elif line.startswith("data: "):
                data = json.loads(line.removeprefix("data: "))
                if name == "token":
                    print(data["text"], end="", flush=True)
                else:
                    print(f"\n[{name}] {json.dumps(data)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
