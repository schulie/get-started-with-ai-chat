import base64
import json
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from api.secure_config import SecureConfig
from api.secure_app import create_app
from api.azure_media import verify_data_policy
from api.web_reader import public_url, extract_page, PublicResolver, read_public_page
from api.uploads import UploadError

BASE = SecureConfig("0b565777-2294-4ad4-983d-985158812485", "jaymedical.com",
                    "https://beta.jaymedical.com", "https://test.openai.azure.com", "chat",
                    approved=frozenset({"chat"}))


def staff():
    return {"Origin": BASE.origin, "x-ms-client-principal-id": "00000000-0000-0000-0000-000000000001",
            "x-ms-client-principal": base64.b64encode(json.dumps({"auth_typ": "aad", "claims": [
                {"typ": "tid", "val": BASE.tenant}, {"typ": "preferred_username", "val": "synthetic@jaymedical.com"}
            ]}).encode()).decode()}


def test_beta_is_explicit_and_web_cannot_be_enabled_in_phi_mode():
    assert BASE.data_mode == "phi"
    with pytest.raises(ValueError): replace(BASE, data_mode="typo")
    with pytest.raises(ValueError): replace(BASE, web_enabled=True)


@pytest.mark.asyncio
async def test_beta_policy_does_not_claim_retention_approval_and_phi_still_checks():
    called = []
    async def unavailable(config, credential):
        called.append(config.data_mode)
        raise RuntimeError("not_approved")
    await verify_data_policy(replace(BASE, data_mode="non_sensitive_beta"), None, unavailable)
    assert called == []
    with pytest.raises(RuntimeError): await verify_data_policy(BASE, None, unavailable)
    assert called == ["phi"]


def test_beta_auth_and_classification_and_web_no_document_forwarding(monkeypatch):
    config = replace(BASE, data_mode="non_sensitive_beta", web_enabled=True)
    seen = []
    async def page(url):
        seen.append(url)
        return {"url": url, "text": "Synthetic public facts"}
    monkeypatch.setattr("api.web_reader.read_public_page", page)
    with TestClient(create_app(config, SimpleNamespace())) as client:
        assert client.get("/api/capabilities").status_code == 403
        headers = staff()
        assert client.get("/api/capabilities", headers=headers).json()["dataMode"] == "non_sensitive_beta"
        assert client.post("/api/web", headers=headers, json={"urls": ["https://example.com/"]}).status_code == 403
        headers["X-JMCGPT-Data-Classification"] = "non-sensitive"
        response = client.post("/api/web", headers=headers, json={"urls": ["https://example.com/"]})
        assert response.status_code == 200 and "https://example.com/" in response.text
        assert seen == ["https://example.com/"]
        response = client.post("/api/web", headers=headers, json={"urls": ["https://example.com/"], "messages": "private"})
        assert response.status_code == 422 and seen == ["https://example.com/"]


@pytest.mark.asyncio
async def test_search_sends_only_query_and_never_stores_responses():
    from aiohttp import web
    from aiohttp.test_utils import TestServer
    from api.azure_media import AzureMedia
    seen = []
    class Credential:
        async def get_token(self, scope):
            assert scope == "https://ai.azure.com/.default"
            return SimpleNamespace(token="synthetic")
        async def close(self): pass
    async def search(request):
        seen.append(await request.json())
        return web.json_response({"status":"completed", "output":[
            {"type":"web_search_call", "status":"completed", "action":{"sources":[{"url":"https://example.com/"}]}},
            {"type":"message", "content":[{"type":"output_text", "text":"Public facts", "annotations":[]}]}]})
    app = web.Application(); app.router.add_post('/openai/v1/responses', search)
    async with TestServer(app) as server:
        config = replace(BASE, endpoint=str(server.make_url('')).rstrip('/'), data_mode="non_sensitive_beta", web_enabled=True)
        media = AzureMedia(config, Credential())
        try:
            result = await media.search("Public query")
            assert "https://example.com/" in result
            assert seen[0]['store'] is False and seen[0]['background'] is False
            assert seen[0]['input'] == 'Public query'
            assert not {'previous_response_id','conversation','messages','attachments'} & seen[0].keys()
        finally: await media.close()


def test_search_endpoint_rejects_chat_history():
    seen = []
    class Media:
        async def search(self, query): seen.append(query); return 'Public result https://example.com/'
    config = replace(BASE, data_mode="non_sensitive_beta", web_enabled=True)
    with TestClient(create_app(config, Media())) as client:
        headers = {**staff(), 'X-JMCGPT-Data-Classification':'non-sensitive'}
        assert client.post('/api/search', headers=headers, json={'query':'public query', 'messages':'private'}).status_code == 422
        assert client.post('/api/search', headers=headers, json={'query':'public query'}).status_code == 200
        assert seen == ['public query']


@pytest.mark.parametrize("url", ["http://example.com", "https://127.0.0.1/", "https://10.0.0.1/",
    "https://169.254.169.254/metadata", "https://[::1]/", "https://localhost/", "https://user:pass@example.com/",
    "https://example.com:8443/", "file:///etc/passwd", "https://example.com\\@127.0.0.1", "https://example.com/\n"])
def test_private_network_and_credential_urls_rejected(url):
    with pytest.raises(UploadError): public_url(url)


def test_html_is_text_only_and_bounded():
    assert public_url("https://example.com/page#fragment") == "https://example.com/page"
    text = extract_page(b'<head>private title</head><h1>Public title</h1><script>secret()</script><p>Facts &amp; evidence</p>', "text/html")
    assert "Public title" in text and "Facts & evidence" in text
    assert "secret" not in text and "private title" not in text
    with pytest.raises(UploadError): extract_page(b'a' * 80_001, "text/plain")


@pytest.mark.asyncio
async def test_dns_answer_must_be_entirely_public():
    class DNS:
        async def resolve(self, *args): return [{"host": "93.184.216.34"}, {"host": "10.0.0.1"}]
        async def close(self): pass
    resolver = PublicResolver()
    await resolver.delegate.close()
    resolver.delegate = DNS()
    with pytest.raises(OSError): await resolver.resolve("example.com", 443)
    await resolver.close()


@pytest.mark.asyncio
async def test_redirect_to_private_network_is_denied(monkeypatch):
    class Reply:
        status = 302
        headers = {"Location": "https://169.254.169.254/metadata"}
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    class HTTP:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        def get(self, url, **kwargs): return Reply()
    monkeypatch.setattr("api.web_reader.aiohttp.ClientSession", HTTP)
    with pytest.raises(UploadError): await read_public_page("https://example.com")
