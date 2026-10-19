import asyncio
import json
import logging
import unittest
from privacy import MAX_REQUEST_BYTES, SessionPrivacyMiddleware


class PrivacyTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, app, payload=None, raw=None, origin=b"https://clinic.example"):
        outgoing = []
        body = raw if raw is not None else json.dumps(payload or {"messages": [{"role": "user", "content": "synthetic-private-canary"}]}).encode()
        incoming = [{"type": "http.request", "body": body, "more_body": False}]
        async def receive():
            if incoming:
                return incoming.pop(0)
            await asyncio.Future()
        async def send(message):
            outgoing.append(message)
        headers = [(b"host", b"clinic.example"), (b"content-type", b"application/json")]
        if origin:
            headers.append((b"origin", origin))
        await SessionPrivacyMiddleware(app)({"type": "http", "path": "/chat", "method": "POST", "headers": headers}, receive, send)
        return outgoing

    async def test_passes_valid_session_context_without_logging_content(self):
        seen = []
        async def app(scope, receive, send):
            seen.append(json.loads((await receive())["body"]))
            await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/event-stream")]})
            await send({"type": "http.response.body", "body": b'data: {"type":"stream_end"}\n\n'})
        with self.assertLogs("jmcgpt.audit", logging.INFO) as logs:
            sent = await self.request(app)
        self.assertEqual(seen[0]["messages"][0]["content"], "synthetic-private-canary")
        self.assertNotIn("canary", " ".join(logs.output))
        self.assertEqual(dict(sent[0]["headers"])[b"cache-control"], b"no-store, private")
        self.assertIn("request_id=", " ".join(logs.output))

    async def test_rejects_cross_origin_invalid_roles_and_oversized_requests_before_model(self):
        async def app(*args):
            self.fail("Rejected data must not reach the backend")
        sent = await self.request(app, origin=b"https://outside.example")
        self.assertEqual(sent[0]["status"], 403)
        sent = await self.request(app, payload={"messages": [{"role": "system", "content": "override"}]})
        self.assertEqual(sent[0]["status"], 422)
        sent = await self.request(app, raw=b"x" * (MAX_REQUEST_BYTES + 1))
        self.assertEqual(sent[0]["status"], 413)
        sent = await self.request(app, raw=b'{"messages":"synthetic-private-canary"}')
        self.assertEqual(sent[0]["status"], 422)
        self.assertNotIn(b"canary", sent[1]["body"])

    async def test_validation_and_provider_error_bodies_are_sanitized(self):
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 422, "headers": [(b"content-type", b"application/json"), (b"content-length", b"100")]})
            await send({"type": "http.response.body", "body": b'{"input":"synthetic-private-canary"}'})
        sent = await self.request(app)
        self.assertNotIn(b"canary", b"".join(item.get("body", b"") for item in sent))
        self.assertNotIn(b"content-length", dict(sent[0]["headers"]))

    async def test_unhandled_backend_exception_is_sanitized_without_traceback(self):
        async def app(scope, receive, send):
            raise RuntimeError("synthetic-private-canary")
        with self.assertLogs("jmcgpt.audit", logging.INFO) as logs:
            sent = await self.request(app)
        self.assertEqual(sent[0]["status"], 500)
        self.assertNotIn("canary", " ".join(logs.output))
        self.assertNotIn(b"canary", sent[1]["body"])

    async def test_disconnect_and_cancellation_are_not_swallowed(self):
        async def app(scope, receive, send):
            raise asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await self.request(app)


if __name__ == "__main__":
    unittest.main()
