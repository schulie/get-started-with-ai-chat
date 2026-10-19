"""Request bounds, non-content audit events and cache protection for JMCGPT.

No conversation or uploaded text is written by this middleware. Existing Azure
identity/access controls remain the authentication boundary.
"""
import json
import logging
import time
from urllib.parse import urlsplit
from uuid import UUID, uuid4

MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_MESSAGES = 100
MAX_CONTENT_CHARS = 400_000
logger = logging.getLogger("jmcgpt.audit")


class SessionPrivacyMiddleware:
    def __init__(self, app):
        self.app = app

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

        async def reject(code):
            nonlocal status
            status = code
            body = json.dumps({"error": {"code": "request_rejected"}}).encode()
            await send({"type": "http.response.start", "status": code, "headers": [
                (b"content-type", b"application/json"), (b"cache-control", b"no-store, private"),
                (b"x-request-id", request_id.encode()), (b"x-content-type-options", b"nosniff"),
            ]})
            await send({"type": "http.response.body", "body": body})

        try:
            app_receive = receive
            if is_chat:
                origin = headers.get(b"origin")
                if origin:
                    try:
                        parsed = urlsplit(origin.decode("ascii"))
                        valid = parsed.scheme in ("http", "https") and not parsed.username and not parsed.password
                        valid = valid and parsed.netloc.lower() == headers.get(b"host", b"").decode("ascii").lower()
                    except (ValueError, UnicodeError):
                        valid = False
                    if not valid:
                        return await reject(403)
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
