"""Short-lived parser process: bounded resources and no files on disk."""
import sys


def main():
    try:
        if sys.platform != "win32":
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (384 * 1024**2, 384 * 1024**2))
            resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
            resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        import base64
        import json
        from dataclasses import asdict
        from .uploads import parse_file, MAX_FILE_BYTES
        request = json.loads(sys.stdin.buffer.read(MAX_FILE_BYTES * 2))
        data = base64.b64decode(request["data"], validate=True)
        if len(data) > MAX_FILE_BYTES:
            raise ValueError()
        result = asdict(parse_file(request["suffix"], data, request.get("video_enabled", False)))
        result["audio_data"] = (base64.b64encode(result["audio"]).decode("ascii")
                                if result["images"] and result["audio"] else "")
        result["audio"] = bool(result["audio"])
        print(json.dumps({"result": result}))
    except Exception as exc:
        from .uploads import UploadError
        code = exc.code if isinstance(exc, UploadError) else "invalid_file"
        print('{"error":' + __import__("json").dumps(code) + '}')


if __name__ == "__main__":
    main()
