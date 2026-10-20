import io
import json
import base64
from pathlib import Path
import sys
from types import SimpleNamespace
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from api.azure_media import AzureMedia, ProviderError, verify_retention_properties
from api.secure_config import SecureConfig


class Credential:
    async def get_token(self, scope):
        assert scope == "https://cognitiveservices.azure.com/.default"
        return SimpleNamespace(token="synthetic-test-token")
    async def close(self): pass


async def reviewed_for_test(_config, _credential):
    pass


def test_retention_gate_rejects_unknown_enabled_or_other_resource():
    config = SimpleNamespace(endpoint='https://test.openai.azure.com')
    base = {'endpoint': 'https://test.openai.azure.com/', 'capabilities': []}
    with pytest.raises(ValueError): verify_retention_properties(config, base)
    base['capabilities'] = [{'name':'ContentLogging','value':'true'}]
    with pytest.raises(ValueError): verify_retention_properties(config, base)
    base['capabilities'] = [{'name':'ContentLogging','value':'false'}]
    verify_retention_properties(config, base)
    base['endpoint'] = 'https://different.openai.azure.com/'
    with pytest.raises(ValueError): verify_retention_properties(config, base)


@pytest.mark.asyncio
async def test_retention_failure_blocks_inference_before_content_is_sent():
    async def reject(_config, _credential):
        raise RuntimeError('retention_unverified')
    config = SecureConfig('tenant','jaymedical.com','https://clinic.test','https://test.openai.azure.com','chat',approved=frozenset({'chat'}))
    media = AzureMedia(config, Credential(), retention_verifier=reject)
    try:
        with pytest.raises(RuntimeError, match='retention_unverified'):
            _ = [part async for part in media.stream([{'role':'user','content':'Synthetic'}])]
    finally:
        await media.close()


@pytest.mark.asyncio
async def test_stateless_stream_uses_only_configured_deployment():
    seen = []
    async def handler(request):
        seen.append((request.path, await request.json()))
        assert request.headers["Authorization"] == "Bearer synthetic-test-token"
        return web.Response(body=b'data: {"choices":[{"delta":{"content":"Synthetic"}}]}\n\ndata: [DONE]\n\n', content_type="text/event-stream")
    app = web.Application(); app.router.add_post('/openai/deployments/chat/chat/completions', handler)
    async with TestServer(app) as server:
        config = SecureConfig("tenant", "jaymedical.com", "https://clinic.test", str(server.make_url('')).rstrip('/'), "chat", approved=frozenset({'chat'}))
        media = AzureMedia(config, Credential(), retention_verifier=reviewed_for_test)
        try:
            result = ''.join([chunk async for chunk in media.stream([{'role':'user','content':'Synthetic'}])])
            assert result == 'Synthetic'
            assert seen[0][1]['stream'] is True
            assert not {'store', 'tools', 'previous_response_id', 'conversation'} & seen[0][1].keys()
        finally: await media.close()


@pytest.mark.asyncio
async def test_audio_filename_and_upstream_error_redaction():
    seen = []
    async def handler(request):
        reader = await request.multipart()
        part = await reader.next()
        seen.append((part.filename, await part.read()))
        return web.json_response({'error': {'message':'synthetic-private-canary'}}, status=403)
    app = web.Application(); app.router.add_post('/openai/deployments/audio/audio/transcriptions', handler)
    async with TestServer(app) as server:
        config = SecureConfig("tenant", "jaymedical.com", "https://clinic.test", str(server.make_url('')).rstrip('/'), "chat", transcription='audio', approved=frozenset({'chat','transcription'}))
        media = AzureMedia(config, Credential(), retention_verifier=reviewed_for_test)
        try:
            with pytest.raises(ProviderError) as error: await media.transcribe(b'Synthetic audio', '.wav')
            assert 'canary' not in str(error.value)
            assert seen == [('audio.wav', b'Synthetic audio')]
        finally: await media.close()


@pytest.mark.asyncio
async def test_image_generation_consumes_bytes_without_remote_fetch():
    buffer = io.BytesIO(); Image.new('RGB', (8,8)).save(buffer, 'PNG')
    seen = []
    async def handler(request):
        seen.append(await request.json())
        return web.json_response({'data':[{'b64_json':base64.b64encode(buffer.getvalue()).decode()}]})
    app = web.Application(); app.router.add_post('/openai/deployments/image/images/generations', handler)
    async with TestServer(app) as server:
        config = SecureConfig("tenant", "jaymedical.com", "https://clinic.test", str(server.make_url('')).rstrip('/'), "chat", images='image', approved=frozenset({'chat','images'}))
        media = AzureMedia(config, Credential(), retention_verifier=reviewed_for_test)
        try:
            result = await media.image('Synthetic circle')
            assert result.startswith('data:image/jpeg;base64,')
            assert seen[0]['n'] == 1 and seen[0]['prompt'] == 'Synthetic circle'
        finally: await media.close()
