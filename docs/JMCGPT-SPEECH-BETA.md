# Speech in 2.0.0-beta.5

In Chat, select Mic to request microphone access. Recording stays in browser memory, with a 60-second / 8 MiB limit. Finish recording, then explicitly select Transcribe to send it to the existing Azure Whisper deployment. Review or edit the transcript in the message box and press Send when ready. Transcription does not automatically submit a chat query. Discard, page hiding, navigation or session unmount stops tracks, discards local chunks and aborts pending work. The server's dictation route is restricted to the authenticated non-sensitive beta and uses the existing no-store, exact-origin, rate/concurrency and content-free audit controls.

Completed answers have Read aloud and Stop reading controls. Only browser voices marked localService=true are eligible; remote voices are excluded. A compatible installed voice is required. Playback stops when the page is hidden or the conversation is cleared. It reads the first 12,000 characters, omitting code blocks, links' URL targets and markup. No cloud TTS resource, new model deployment or recording history is created.

This is dictation and optional playback, not a continuous live voice conversation. Existing uploaded audio/video transcription remains available. No PHI approval is implied; beta use is limited to synthetic/non-sensitive data while provider-retention approval is pending.

Validation includes explicit-upload timing, track cleanup, discarded late results, local-only voice selection and playback cancellation. Tests simulate microphone and speech APIs; live hardware microphone capture is left to the staff member's explicit browser permission and action.
