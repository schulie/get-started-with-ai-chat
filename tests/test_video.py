import asyncio
import base64
import io
import sys
from pathlib import Path

import av
import pytest
from PIL import Image
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from api.uploads import parse_file, UploadError
from api.secure_app import isolated_parse, create_app
from api.secure_config import SecureConfig
from test_secure_app import TENANT, ORIGIN, FakeMedia, identity


def clip(seconds=2, audio=False, kind="mp4"):
    output = io.BytesIO()
    with av.open(output, mode="w", format=kind) as container:
        video = container.add_stream("libvpx" if kind == "webm" else "mpeg4", rate=8)
        video.width = 160; video.height = 96; video.pix_fmt = "yuv420p"
        sound = container.add_stream("aac", rate=16000) if audio else None
        for index in range(seconds * 8):
            image = Image.new("RGB", (160, 96), "red" if index < seconds * 4 else "blue")
            frame = av.VideoFrame.from_image(image)
            for packet in video.encode(frame): container.mux(packet)
        for packet in video.encode(): container.mux(packet)
        if sound:
            for index in range(seconds * 16):
                frame = av.AudioFrame(format="s16", layout="mono", samples=1000)
                frame.sample_rate = 16000; frame.pts = index * 1000
                frame.planes[0].update(bytes(2000))
                for packet in sound.encode(frame): container.mux(packet)
            for packet in sound.encode(): container.mux(packet)
    return output.getvalue()


def test_frames_are_bounded_and_timestamped():
    parsed = parse_file(".mp4", clip(), video_enabled=True)
    assert 2 <= len(parsed.images) <= 8
    assert "frame 1: 0.00s" in parsed.text and "Brief events" in parsed.text
    assert "No audio track" in parsed.text
    assert all(image.startswith("data:image/jpeg;base64,") for image in parsed.images)
    for encoded in parsed.images:
        with Image.open(io.BytesIO(base64.b64decode(encoded.split(",")[1]))) as image:
            assert max(image.size) <= 768


def test_video_gate_and_duration_and_invalid_container():
    with pytest.raises(UploadError, match="capability_unavailable"):
        parse_file(".mp4", clip())
    with pytest.raises(UploadError, match="video_limits"):
        parse_file(".mp4", clip(61), video_enabled=True)
    with pytest.raises(UploadError, match="invalid_video"):
        parse_file(".mp4", b"#EXTM3U\nhttps://127.0.0.1/private", video_enabled=True)


def test_isolation_extracts_wav_and_preserves_visual_context():
    parsed = asyncio.run(isolated_parse(".mp4", clip(audio=True), True))
    assert parsed["audio"] and parsed["audio_data"] and parsed["suffix"] == ".wav"
    assert base64.b64decode(parsed["audio_data"]).startswith(b"RIFF")
    assert parsed["images"] and "sampled" in parsed["text"]


def test_upload_transcribes_extracted_audio_and_retains_timestamps():
    config = SecureConfig(TENANT, "jaymedical.com", ORIGIN, "https://test.openai.azure.com", "chat",
        vision="vision", transcription="audio", approved=frozenset({"chat", "vision", "transcription"}),
        data_mode="non_sensitive_beta", video_analysis_enabled=True)
    provider = FakeMedia()
    headers = identity(); headers["X-JMCGPT-Data-Classification"] = "non-sensitive"
    with TestClient(create_app(config, provider)) as client:
        assert client.get("/api/capabilities", headers=headers).json()["videoAnalysis"] is True
        response = client.post("/api/attachments", headers=headers,
            json={"files": [{"name": "synthetic.mp4", "data": base64.b64encode(clip(audio=True)).decode()}]})
        assert response.status_code == 200, response.text
        text = response.json()["parts"][0]["text"]
        assert "frame 1:" in text and "Synthetic transcript" in text
        assert provider.audio[0].startswith(b"RIFF") and provider.audio[1] == ".wav"
        assert "audio_data" not in response.text
        assert response.headers["cache-control"] == "no-store, private"


def test_video_never_enabled_in_phi_mode():
    with pytest.raises(ValueError, match="beta mode"):
        SecureConfig(TENANT, "jaymedical.com", ORIGIN, "https://test.openai.azure.com", "chat",
            approved=frozenset({"chat", "vision"}), video_analysis_enabled=True)


@pytest.mark.parametrize("suffix,kind", [(".mov", "mov"), (".mkv", "matroska"), (".webm", "webm")])
def test_supported_video_containers(suffix, kind):
    parsed = parse_file(suffix, clip(kind=kind), video_enabled=True)
    assert parsed.images and "frame 1:" in parsed.text


def test_audio_only_webm_stays_an_audio_upload():
    buffer = io.BytesIO()
    with av.open(buffer, mode="w", format="webm") as container:
        stream = container.add_stream("libopus", rate=48000)
        frame = av.AudioFrame(format="s16", layout="mono", samples=4800)
        frame.sample_rate = 48000
        frame.planes[0].update(bytes(9600))
        for packet in stream.encode(frame): container.mux(packet)
        for packet in stream.encode(): container.mux(packet)
    data = buffer.getvalue()
    parsed = parse_file(".webm", data)
    assert parsed.audio == data and not parsed.images
