"""Decode short clips in the isolated upload worker, using memory only."""
import base64
import io
import math
import wave

from .uploads import ParsedFile, UploadError

MAX_SECONDS = 60
MAX_FRAMES = 8


def parse_video(suffix, data, enabled):
    import av
    # Force self-contained media containers, never playlists or external URLs.
    kind = "mov" if suffix in {".mp4", ".mov"} else "matroska"
    try:
        with av.open(io.BytesIO(data), format=kind, options={"protocol_whitelist": "", "enable_drefs": "0", "use_absolute_path": "0"}) as container:
            if not container.streams.video:
                if suffix == ".webm":
                    return None  # Preserve audio-only WebM transcription.
                raise UploadError("invalid_video")
            if not enabled:
                raise UploadError("capability_unavailable")
            if len(container.streams.video) != 1 or len(container.streams.audio) > 1:
                raise UploadError("video_limits")
            stream = container.streams.video[0]
            stream.thread_type = "NONE"
            stream.codec_context.thread_count = 1
            duration = float(stream.duration * stream.time_base) if stream.duration is not None else (
                container.duration / av.time_base if container.duration is not None else 0)
            if not math.isfinite(duration) or not 0 < duration <= MAX_SECONDS:
                raise UploadError("video_limits")
            if stream.width * stream.height > 1920 * 1080 or float(stream.average_rate or 0) > 60:
                raise UploadError("video_limits")
            interval = duration / (MAX_FRAMES - 1)
            images, times, last, previous = [], [], None, -1.0
            start = float((stream.start_time or 0) * stream.time_base)
            for count, frame in enumerate(container.decode(stream)):
                if count >= 3601 or frame.time is None or frame.width * frame.height > 1920 * 1080:
                    raise UploadError("video_limits")
                timestamp = float(frame.time) - start
                if not math.isfinite(timestamp) or timestamp < previous or timestamp > MAX_SECONDS + .05:
                    raise UploadError("video_limits")
                previous = timestamp
                if not images or timestamp >= len(images) * interval or timestamp >= duration - .25:
                    image = frame.to_image().convert("RGB")
                    image.thumbnail((768, 768))
                    output = io.BytesIO()
                    image.save(output, "JPEG", quality=80)
                    last = ("data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode(), timestamp)
                    if len(images) < MAX_FRAMES:
                        images.append(last[0]); times.append(timestamp)
                    else:
                        images[-1], times[-1] = last
            if not images:
                raise UploadError("invalid_video")
            has_audio = bool(container.streams.audio)
        audio = _audio(av, kind, data) if has_audio else b""
        timing = ", ".join(f"frame {i + 1}: {time:.2f}s" for i, time in enumerate(times))
        return ParsedFile(text=(f"Video: {duration:.2f} seconds. The following {len(images)} images are sparse sampled "
            f"frames in order ({timing}). Brief events between samples may be missed; do not claim continuous "
            "observation, exact event boundaries, or speaker timing. Frame timestamps are relative to the video track. "
            + ("Audio transcript follows separately, without word timestamps." if audio else "No audio track.")),
            images=images, audio=audio, suffix=".wav")
    except UploadError:
        raise
    except Exception:
        raise UploadError("invalid_video") from None


def _audio(av, kind, data):
    pcm = bytearray()
    with av.open(io.BytesIO(data), format=kind, options={"protocol_whitelist": "", "enable_drefs": "0", "use_absolute_path": "0"}) as container:
        stream = container.streams.audio[0]
        stream.codec_context.thread_count = 1
        if stream.codec_context.sample_rate > 96000 or stream.codec_context.channels > 2:
            raise UploadError("video_limits")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        samples = 0
        def append(frames):
            for frame in frames:
                pcm.extend(bytes(frame.planes[0])[:frame.samples * 2])
                if len(pcm) > MAX_SECONDS * 16000 * 2:
                    raise UploadError("video_limits")
        for count, frame in enumerate(container.decode(stream)):
            samples += frame.samples
            if count > 10000 or samples > MAX_SECONDS * frame.sample_rate:
                raise UploadError("video_limits")
            append(resampler.resample(frame))
        append(resampler.resample(None))
    if not pcm:
        raise UploadError("invalid_video")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
        wav.writeframes(pcm)
    return output.getvalue()
