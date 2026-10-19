import json
import unittest
from unittest.mock import patch

import httpx

from azure_openai_chat import AzureOpenAIChatClient, AzureModelStreamError, RENDERING_INSTRUCTIONS, _text_deltas


def event(kind, **fields):
    return "event: " + kind + "\ndata: " + json.dumps({"type": kind, **fields}, ensure_ascii=False) + "\n\n"


async def lines(text):
    for line in text.splitlines():
        yield line


async def collect(text):
    return "".join([part async for part in _text_deltas(lines(text))])


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_instructions_authentication_and_live_text_contract(self):
        wire = event("response.created", response={"status": "in_progress"})
        wire += event("response.reasoning_summary_text.delta", delta="Private reasoning must not appear")
        wire += event("response.output_text.delta", delta="Héllo ")
        wire += event("response.output_text.delta", delta="clinic")
        wire += event("response.completed", response={"status": "completed"})
        history = [{"role": "user", "content": "First"}, {"role": "assistant", "content": "Prior"}, {"role": "user", "content": "Next"}]
        requests = []

        def handler(request):
            requests.append(request)
            self.assertEqual(str(request.url), "https://clinic.services.ai.azure.com/openai/v1/responses")
            self.assertEqual(request.headers["Authorization"], "Bearer test-token")
            body = json.loads(request.content)
            self.assertEqual(body["input"], history)
            self.assertEqual(body["instructions"], "Original instructions and document context" + RENDERING_INSTRUCTIONS)
            self.assertEqual(body["model"], "jmcgpt-astra")
            self.assertEqual(body["reasoning"], {"effort": "xhigh"})
            self.assertEqual(body["max_output_tokens"], 32768)
            self.assertIs(body["store"], False)
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=wire.encode())

        transport = httpx.MockTransport(handler)
        original = httpx.AsyncClient
        with patch("azure_openai_chat.httpx.AsyncClient", side_effect=lambda **kw: original(transport=transport, **kw)):
            client = AzureOpenAIChatClient(base_url="https://clinic.services.ai.azure.com/anthropic", auth_token="test-token")
        try:
            async with client.messages.stream(model="jmcgpt-astra", max_tokens=32768, system="Original instructions and document context", messages=history) as stream:
                self.assertEqual("".join([text async for text in stream.text_stream]), "Héllo clinic")
        finally:
            await client.close()
        self.assertEqual(len(requests), 1)
        self.assertTrue(client._client.is_closed)

    async def test_multiline_sse_comments_and_final_event_without_blank_line(self):
        wire = ': keepalive\nevent: response.output_text.delta\ndata: {"type": "response.output_text.delta",\ndata: "delta": "OK"}\n\n'
        wire += 'data: {"type":"response.completed","response":{}}'
        self.assertEqual(await collect(wire), "OK")

    async def test_refusal_is_visible_and_final_snapshot_is_not_duplicated(self):
        wire = event("response.refusal.delta", delta="Cannot provide that.")
        wire += event("response.completed", response={"output": [{"type": "message", "content": [{"type": "refusal", "refusal": "Cannot provide that."}]}]})
        self.assertEqual(await collect(wire), "Cannot provide that.")

    async def test_output_limit_preserves_partial_text_with_explicit_notice(self):
        wire = event("response.output_text.delta", delta="Partial answer")
        wire += event("response.incomplete", response={"incomplete_details": {"reason": "max_output_tokens"}})
        text = await collect(wire)
        self.assertTrue(text.startswith("Partial answer"))
        self.assertIn("output limit", text)

    async def test_failures_do_not_expose_provider_message_contents(self):
        wire = event("response.failed", response={"error": {"code": "server_error", "message": "sensitive-canary"}})
        with self.assertRaises(AzureModelStreamError) as caught:
            await collect(wire)
        self.assertIn("server_error", str(caught.exception))
        self.assertNotIn("sensitive-canary", str(caught.exception))
        for status in (307, 401, 429, 500):
            calls = []

            def handler(request):
                calls.append(request)
                return httpx.Response(status, headers={"Location": "https://outside.example/"}, json={"error": {"code": "failure", "message": "sensitive-canary"}})

            original = httpx.AsyncClient
            with patch("azure_openai_chat.httpx.AsyncClient", side_effect=lambda **kw: original(transport=httpx.MockTransport(handler), **kw)):
                client = AzureOpenAIChatClient(base_url="https://clinic.services.ai.azure.com/anthropic", auth_token="test-token")
            try:
                with self.assertRaises(AzureModelStreamError) as caught:
                    async with client.stream(model="jmcgpt-astra", max_tokens=32768, system="", messages=[]):
                        self.fail("An unsuccessful response must not open a text stream")
                self.assertNotIn("sensitive-canary", str(caught.exception))
                self.assertEqual(len(calls), 1)
            finally:
                await client.close()

    async def test_incomplete_or_empty_stream_is_not_reported_as_success(self):
        for wire in (event("response.output_text.delta", delta="Unfinished"), 'data: [DONE]\n\n', event("response.completed", response={}), 'data: invalid-json\n\n'):
            with self.assertRaises(AzureModelStreamError):
                await collect(wire)

    async def test_final_snapshot_only_response_is_rendered(self):
        wire = event("response.completed", response={"output": [{"type": "message", "content": [{"type": "output_text", "text": "Final only"}]}]})
        self.assertEqual(await collect(wire), "Final only")

    async def test_credential_destination_validation(self):
        invalid = ["http://clinic.services.ai.azure.com/anthropic", "https://outside.example/anthropic", "https://clinic.services.ai.azure.com.evil.example/", "https://user:password@clinic.services.ai.azure.com/", "https://clinic.services.ai.azure.com/?key=value"]
        for url in invalid:
            with self.assertRaises(ValueError):
                AzureOpenAIChatClient(base_url=url, auth_token="test-token")


if __name__ == "__main__":
    unittest.main()
