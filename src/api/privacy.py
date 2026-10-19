"""Request bounds, non-content audit events and cache protection for JMCGPT.

No conversation or uploaded text is written by this middleware. Existing Azure
identity/access controls remain the authentication boundary.
"""
import json
import logging
import os
import time
from urllib.parse import urlsplit
from uuid import UUID, uuid4

MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_MESSAGES = 100
MAX_CONTENT_CHARS = 400_000
logger = logging.getLogger("jmcgpt.audit")


def origin_key(value):
    """Compare complete origins without trusting client-supplied proxy headers."""
    try:
        if (not value or any(ord(character) < 33 or ord(character) > 126 for character in value)
            or "?" in value or "#" in value):
            return None
        parsed = urlsplit(value)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.path or parsed.query or parsed.fragment):
            return None
        port = parsed.port
        if port is None:
            port = 443 if parsed.scheme == "https" else 80
        if port < 1:
            return None
        return parsed.scheme, parsed.hostname.lower(), port
    except (ValueError, UnicodeError):
        return None


class SessionPrivacyMiddleware:
    def __init__(self, app, public_origin=None):
        self.app = app
        configured = public_origin if public_origin is not None else os.getenv("JMCGPT_PUBLIC_ORIGIN")
        self.public_origin = origin_key(configured) if configured is not None else None
        if configured is not None and self.public_origin is None:
            raise ValueError("Invalid public origin configuration")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        is_chat = path == "/chat"
        request_id = str(uuid4())
        started = time.monotonic()
        status = 500
        headers = {name.lower(): value for name, value in scope.get("headers", [])}
        subject = "unavailable"
        try:
            subject = str(UUID(headers.get(b"x-ms-client-principal-id", b"").decode("ascii")))
        except (ValueError, UnicodeError):
            pass

        async def reject(code, error_code="request_rejected"):
            nonlocal status
            status = code
            body = json.dumps({"error": {"code": error_code}}).encode()
            await send({"type": "http.response.start", "status": code, "headers": [
                (b"content-type", b"application/json"), (b"cache-control", b"no-store, private"),
                (b"x-request-id", request_id.encode()), (b"x-content-type-options", b"nosniff"),
            ]})
            await send({"type": "http.response.body", "body": body})

        try:
            app_receive = receive
            if is_chat:
                origins = [value for name, value in scope.get("headers", []) if name.lower() == b"origin"]
                if len(origins) > 1:
                    return await reject(403, "origin_rejected")
                if origins:
                    try:
                        incoming_origin = origin_key(origins[0].decode("ascii"))
                        # Azure ingress may replace Host and terminate TLS. The
                        # configured public origin remains the browser boundary.
                        expected_origin = self.public_origin
                        if expected_origin is None:
                            host = headers.get(b"host", b"").decode("ascii")
                            expected_origin = origin_key(scope.get("scheme", "http") + "://" + host)
                        valid = incoming_origin is not None and incoming_origin == expected_origin
                    except (ValueError, UnicodeError):
                        valid = False
                    if not valid:
                        return await reject(403, "origin_rejected")
                if scope.get("method") != "POST":
                    return await reject(405)
                if headers.get(b"content-type", b"").split(b";", 1)[0].strip().lower() != b"application/json":
                    return await reject(415)
                body = bytearray()
                while True:
                    part = await receive()
                    if part["type"] == "http.disconnect":
                        status = 499
                        return
                    body.extend(part.get("body", b""))
                    if len(body) > MAX_REQUEST_BYTES:
                        return await reject(413)
                    if not part.get("more_body", False):
                        break
                try:
                    payload = json.loads(body)
                    messages = payload.get("messages") if isinstance(payload, dict) else None
                    valid = isinstance(messages, list) and 0 < len(messages) <= MAX_MESSAGES
                    valid = valid and all(isinstance(item, dict) and item.get("role") in ("user", "assistant")
                        and isinstance(item.get("content"), str) for item in messages)
                    valid = valid and sum(len(item["content"]) for item in messages) <= MAX_CONTENT_CHARS
                    valid = valid and messages[-1]["role"] == "user"
                except (ValueError, TypeError, RecursionError):
                    valid = False
                if not valid:
                    return await reject(422)
                # Replay the bounded request once for FastAPI's existing request model.
                replayed = False

                async def replay():
                    nonlocal replayed
                    if not replayed:
                        replayed = True
                        return {"type": "http.request", "body": bytes(body), "more_body": False}
                    return await receive()

                app_receive = replay

            suppress_body = False
            response_started = False

            async def protected_send(message):
                nonlocal status, suppress_body, response_started
                if message["type"] == "http.response.start":
                    status = message["status"]
                    response_started = True
                    suppress_body = is_chat and status >= 400
                    existing = list(message.get("headers", []))
                    protected = {b"cache-control", b"pragma", b"referrer-policy", b"x-content-type-options", b"x-request-id"}
                    if suppress_body:
                        protected |= {b"content-length", b"content-type"}
                    existing = [(key, value) for key, value in existing if key.lower() not in protected]
                    existing += [(b"cache-control", b"no-store, private"), (b"pragma", b"no-cache"),
                        (b"referrer-policy", b"no-referrer"), (b"x-content-type-options", b"nosniff"),
                        (b"x-request-id", request_id.encode())]
                    if path == "/":
                        existing += [(b"x-frame-options", b"DENY"),
                            (b"content-security-policy", b"frame-ancestors 'none'; object-src 'none'; base-uri 'self'")]
                    if suppress_body:
                        existing += [(b"content-type", b"application/json")]
                    await send({**message, "headers": existing})
                elif message["type"] == "http.response.body" and suppress_body:
                    if not message.get("more_body", False):
                        await send({"type": "http.response.body", "body": b'{"error":{"code":"request_failed"}}'})
                else:
                    await send(message)

            try:
                await self.app(scope, app_receive, protected_send)
            except Exception:
                if not is_chat:
                    raise
                # Prevent an unhandled provider/search exception from reaching the
                # web server's traceback logger with request or provider content.
                if not response_started:
                    await reject(500)
                else:
                    status = 500
                    await send({"type": "http.response.body", "body": b'data: {"type":"error","error":{"code":"request_failed"}}\n\n'})
        finally:
            if is_chat:
                # No query strings, prompts, response text, filenames or exception bodies.
                logger.info("chat_request request_id=%s subject_id=%s status=%d duration_ms=%d",
                    request_id, subject, status, int((time.monotonic() - started) * 1000))
