import json
import sys
from . import core


def main():
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in core.COMMANDS:
            raise ValueError("command must be validate, export, labelstudio, reconcile, assign, or analyze")
        raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError("input exceeds 8 MiB")
        def invalid_number(value):
            raise ValueError("nonfinite JSON number: " + value)
        data = json.loads(raw, parse_constant=invalid_number)
        if not isinstance(data, dict):
            raise ValueError("input must be an object")
        print(json.dumps(core.COMMANDS[sys.argv[1]](data), ensure_ascii=False, allow_nan=False))
    except (ValueError, TypeError, KeyError, RecursionError) as exc:
        print(json.dumps({"error": str(exc)}))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())