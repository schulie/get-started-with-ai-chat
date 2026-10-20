import base64
import io
import json
import logging
import sys
import zipfile
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from api.secure_config import SecureConfig
from api.secure_app import create_app, isolated_parse
from api.uploads import parse_file, decode_file, normalize_image, UploadError

TENANT = "0b565777-2294-4ad4-983d-985158812485"
ORIGIN = "https://jmcgpt.jaymedical.com"
CANARY = "synthetic-private-canary-314159"


def identity(name="staff@jaymedical.com", tenant=TENANT):
    return {"x-ms-client-principal-id": str(uuid4()), "x-ms-client-principal": base64.b64encode(json.dumps({
        "auth_typ": "aad", "claims": [{"typ": "tid", "val": tenant}, {"typ": "preferred_username", "val": name}]
    }).encode()).decode(), "Origin": ORIGIN}


def image_bytes():
    image = Image.new("RGB", (8, 8), "white")
    exif = Image.Exif(); exif[270] = CANARY
    buffer = io.BytesIO(); image.save(buffer, "JPEG", exif=exif)
    return buffer.getvalue()


class FakeMedia:
    def require(self, feature):
        if feature not in {"chat", "vision", "images", "transcription"}:
            raise UploadError("capability_unavailable")
    async def stream(self, messages, vision=False):
        self.messages, self.vision = messages, vision
        yield "Synthetic answer"
    async def transcribe(self, data, suffix):
        self.audio = (data, suffix)
        return "Synthetic transcript"
    async def image(self, prompt, source=None):
        self.image_call = (prompt, source)
        return normalize_image(image_bytes())


@pytest.fixture
def app():
    config = SecureConfig(TENANT, "jaymedical.com", ORIGIN, "https://test.openai.azure.com", "chat",
                          vision="vision", images="image", transcription="audio",
                          approved=frozenset({"chat", "vision", "images", "transcription"}))
    return create_app(config, FakeMedia())


def test_exact_domain_and_tenant_boundary(app):
    with TestClient(app) as client:
        assert client.get("/").status_code == 403
        assert client.get("/", headers=identity()).status_code == 200
        for name in ("staff@jaymedical.com.evil.test", "jaymedical.com@evil.test", "staff@external.com"):
            assert client.get("/", headers=identity(name)).status_code == 403
        assert client.get("/", headers=identity(tenant=str(uuid4()))).status_code == 403
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/docs", headers=identity()).status_code == 404


def test_chat_security_headers_origin_and_validation_redaction(app, caplog):
    body = {"messages": [{"role": "user", "content": CANARY}]}
    with TestClient(app) as client, caplog.at_level(logging.INFO, logger="jmcgpt.audit"):
        headers = identity()
        response = client.post("/chat", json=body, headers=headers)
        assert response.status_code == 200 and "Synthetic answer" in response.text
        assert response.headers["cache-control"] == "no-store, private"
        assert response.headers["referrer-policy"] == "same-origin"
        assert CANARY not in caplog.text
        headers["Origin"] = "https://evil.test"
        assert client.post("/chat", json=body, headers=headers).status_code == 403
        del headers["Origin"]
        assert client.post("/chat", json=body, headers=headers).status_code == 403
        response = client.post("/chat", json={"messages": CANARY}, headers=identity())
        assert response.status_code == 422 and CANARY not in response.text
        response = client.post("/chat", json={"messages": [{"role": "system", "content": CANARY}]}, headers=identity())
        assert response.status_code == 422 and CANARY not in response.text


def test_remote_images_and_assistant_attachments_rejected(app):
    message = {"role": "user", "content": "Analyze", "attachments": [{"type": "image", "data_url": "https://evil.test/track"}]}
    with TestClient(app) as client:
        assert client.post("/chat", json={"messages": [message]}, headers=identity()).status_code == 422
        message.update(role="assistant", attachments=[{"type": "text", "text": "untrusted"}])
        assert client.post("/chat", json={"messages": [message, {"role": "user", "content": "Go"}]}, headers=identity()).status_code == 422


def test_generated_image_and_edit_pass_bytes_not_urls(app):
    with TestClient(app) as client:
        message = {"role": "user", "content": "Draw a circle"}
        response = client.post("/chat", json={"mode": "image", "messages": [message]}, headers=identity())
        assert response.status_code == 200 and '"type": "image"' in response.text
        message["attachments"] = [{"type": "image", "data_url": normalize_image(image_bytes())}]
        response = client.post("/chat", json={"mode": "image", "messages": [message]}, headers=identity())
        assert response.status_code == 200
        assert app.state.media.image_call[1].startswith("data:image/jpeg;base64,")


def test_provider_errors_never_expose_private_content(app):
    async def fail(*args, **kwargs):
        raise RuntimeError(CANARY)
        yield ""
    app.state.media.stream = fail
    with TestClient(app) as client:
        response = client.post("/chat", json={"messages": [{"role": "user", "content": "Synthetic"}]}, headers=identity())
        assert '"type": "error"' in response.text and CANARY not in response.text


def test_image_metadata_removed_and_unsafe_files_rejected():
    url = normalize_image(image_bytes())
    clean = base64.b64decode(url.split(",")[1])
    assert CANARY.encode() not in clean
    for name, data in (("image.svg", b"<svg/>"), ("word.docm", b"macro"), ("image.png", b"not an image")):
        with pytest.raises(UploadError):
            suffix, body = decode_file(name, base64.b64encode(data).decode())
            parse_file(suffix, body)
    with pytest.raises(UploadError): decode_file("test.txt", "not base64!")


def package(entries, compression=zipfile.ZIP_STORED):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=compression) as archive:
        for name, text in entries.items(): archive.writestr(name, text)
    return buffer.getvalue()


def test_docx_xlsx_and_archive_bombs():
    data = package({"word/document.xml": '<w:document xmlns:w="urn:w"><w:p><w:r><w:t>Synthetic document</w:t></w:r></w:p></w:document>'})
    assert "Synthetic document" in parse_file(".docx", data).text
    data = package({"xl/workbook.xml": '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Counts" r:id="rId1"/></sheets></workbook>',
                    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
                    "xl/worksheets/sheet1.xml": '<worksheet><row><c r="A1"><v>42</v></c><c r="B1"><f>EXTERNAL()</f></c></row></worksheet>'})
    result = parse_file(".xlsx", data).text
    assert "Counts" in result and "A1: 42" in result and "not calculated" in result
    for data in (package({"word/document.xml": "A" * 500_000}, zipfile.ZIP_DEFLATED),
                 package({"../escape": "unsafe"}),
                 package({"word/document.xml": '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///secrets">]><x>&a;</x>'})):
        with pytest.raises(UploadError): parse_file(".docx", data)


@pytest.mark.asyncio
async def test_real_isolated_parser_and_scanned_pdf(monkeypatch):
    monkeypatch.chdir(Path(__file__).resolve().parents[1] / "src")
    result = await isolated_parse(".txt", b"Synthetic file")
    assert result["text"] == "Synthetic file"
    from pypdf import PdfWriter
    pdf = PdfWriter(); pdf.add_blank_page(200, 200)
    buffer = io.BytesIO(); pdf.write(buffer)
    result = await isolated_parse(".pdf", buffer.getvalue())
    assert len(result["images"]) == 1


def test_startup_requires_explicit_review_and_trace_disabled(monkeypatch):
    for key, value in {"JMCGPT_TENANT_ID": TENANT, "JMCGPT_STAFF_DOMAIN": "jaymedical.com",
                       "JMCGPT_PUBLIC_ORIGIN": ORIGIN, "AZURE_OPENAI_ENDPOINT": "https://test.openai.azure.com",
                       "AZURE_OPENAI_RESOURCE_ID": "/subscriptions/188f6026-c52a-4ced-b7d8-2ad1f6eb6070/resourceGroups/JayMedical/providers/Microsoft.CognitiveServices/accounts/test",
                       "AZURE_OPENAI_CHAT_DEPLOYMENT": "test"}.items(): monkeypatch.setenv(key, value)
    monkeypatch.delenv("JMCGPT_APPROVED_CAPABILITIES", raising=False)
    with pytest.raises(ValueError): SecureConfig.from_env()
    monkeypatch.setenv("JMCGPT_APPROVED_CAPABILITIES", "chat")
    assert SecureConfig.from_env().domain == "jaymedical.com"
    monkeypatch.setenv("ENABLE_AZURE_MONITOR_TRACING", "True")
    with pytest.raises(ValueError): SecureConfig.from_env()


def test_upload_pipeline_has_no_content_in_audit_or_repeated_server_state(app, caplog):
    data = base64.b64encode(CANARY.encode()).decode()
    with TestClient(app) as client, caplog.at_level(logging.INFO, logger="jmcgpt.audit"):
        response = client.post("/api/attachments", json={"files": [{"name": CANARY + ".txt", "data": data}]}, headers=identity())
        assert response.status_code == 200
        parts = response.json()["parts"]
        assert CANARY in parts[0]["text"]
        assert CANARY not in caplog.text
        response = client.post("/chat", json={"messages": [{"role": "user", "content": "Review", "attachments": parts}]}, headers=identity())
        assert response.status_code == 200
        assert CANARY not in caplog.text
        assert not hasattr(app.state, "uploads") and not hasattr(app.state, "sessions")


def test_request_size_and_busy_limits(app, monkeypatch):
    import api.secure_app as module
    monkeypatch.setattr(module, "MAX_REQUEST", 64)
    with TestClient(app) as client:
        response = client.post("/chat", json={"messages": [{"role": "user", "content": "A" * 100}]}, headers=identity())
        assert response.status_code == 413
        response = client.post("/api/attachments", content="{}", headers={**identity(), "Content-Type": "text/plain"})
        assert response.status_code == 415


def test_audio_upload_transcribes_without_filename_at_provider(app):
    import wave
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000); audio.writeframes(b"\x00\x00" * 80)
    with TestClient(app) as client:
        response = client.post("/api/attachments", json={"files": [{"name": CANARY + ".wav", "data": base64.b64encode(output.getvalue()).decode()}]}, headers=identity())
        assert response.status_code == 200
        assert "Synthetic transcript" in response.json()["parts"][0]["text"]
        assert app.state.media.audio == (output.getvalue(), ".wav")
