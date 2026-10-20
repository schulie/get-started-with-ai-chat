# JMCGPT 2.0.0-beta.4 video analysis

This release adds short-video analysis to the non-sensitive Azure beta. It does not approve the application for PHI. Video analysis cannot be enabled in PHI mode. The existing tenant/domain authentication, MFA policy, session clearing and no-history behavior remain in effect.

Select Video, attach one self-contained MP4, MOV, MKV or WebM clip, and ask a question or send it for a summary. Chat also accepts these uploads. Supported codecs depend on the bundled FFmpeg decoder. Limits are 8 MiB per file, 12 MiB combined uploads, 60 seconds, 1920×1080 pixels, 60 fps, one video track, and at most one mono/stereo audio track. The worker enforces CPU, address space and wall-clock limits; demanding clips may need to be shortened or reduced in resolution.

An isolated subprocess reads the video from memory, samples at most eight JPEG frames, strips image metadata and records frame timestamps relative to the video track. The vision model can summarize those samples, answer questions and read visible text. This is sparse sampling, not continuous video inspection, and may miss brief events. Generated timestamps must not be treated as exact event boundaries. Optional audio is decoded to an in-memory 16 kHz mono WAV and transcribed by the existing Azure Whisper deployment; the transcript has no word or speaker timestamps. Audio-only WebM continues to work.

No original clips, extracted audio, frames or transcripts are saved by the application. The browser retains prepared content only for the active session, cleared by refresh, New Chat, sign-out or 15-minute inactivity. This does not override Azure's provider retention terms. Beta use is restricted to synthetic/non-sensitive material while the Microsoft retention request is pending.

Video generation is **not enabled**. The Azure account catalog lists Sora 2 as Deprecated, while Microsoft's published retirement schedule lists retirement dates already past. Do not deploy this as a supported generation service. Connecting a supported provider, its authenticated project, billing and data terms is still required. No Google service has been configured or granted access.

Validation: all four video containers, invalid media, duration limits, PHI gate, extracted WAV and transcript/visual context integration, audio-only WebM, and frontend send-only-on-submit behavior. Real Azure vision identified the generated red-to-blue sequence and read its synthetic label; real Azure transcription recognized the separate public weather audio sample embedded in the test clip.
