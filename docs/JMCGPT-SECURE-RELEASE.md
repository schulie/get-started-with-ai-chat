# JMCGPT 2.0 release candidate

This candidate implements technical safeguards for a clinic's HIPAA program. It is not a compliance attestation. The working v1.1.1 deployment has not been replaced by this candidate.

## Agreed behavior

- All authenticated `@jaymedical.com` staff in tenant `0b565777-2294-4ad4-983d-985158812485` may use the app. External domains and other tenants are denied. MFA remains enforced by Microsoft Entra policy.
- Conversations, raw uploads, extracted text, transcripts, and generated images stay in browser/process memory. There is no conversation database, disk upload directory, blob library, vector store, Files API, Assistants thread, Responses history, or saved-completions feature.
- Refresh, New Chat, sign-out, and 15 minutes of inactivity clear the browser session. The app cannot promise cryptographic erasure of physical RAM. In-flight service requests and platform retention must be evaluated separately.
- Audit events contain operation, request ID, staff object ID, status, and duration. They exclude prompts, answers, upload names/bytes, transcripts, and provider exception bodies. These security records require their own clinic retention/access policy; they are not chat histories.
- Uploads are sent only on Send. Prepared content is kept in browser memory for follow-up questions; audio is not retranscribed on every turn.

## Supported uploads and bounds

PDF, DOCX, XLSX, CSV/TSV, UTF-8 TXT/Markdown/JSON, PNG/JPEG/WebP, WAV/MP3/M4A/OGG/WebM/FLAC. Six files maximum; 8 MiB each; 12 MiB combined; 300,000 extracted text characters; eight images/scanned pages. PDFs have a 40-page limit; encrypted PDFs and oversized documents are rejected. Image-only PDF pages are rendered in memory for the vision model. DOCX raster images are included; unsupported embedded formats are rejected. XLSX reads cell values and cached formula results without recalculating formulas, following external links, or rendering charts. Old DOC/XLS, macro-enabled documents, SVG, DICOM, video, and arbitrary archives are not supported.

The parser runs in a short-lived subprocess, with a 20-second deadline and Linux CPU/address-space/core/file-size limits. The container runs as an unprivileged user. Image re-encoding removes EXIF and other metadata. These controls still require Linux container testing, image scanning, and adversarial file review before PHI use.

## Azure review on 2026-10-19

The existing `jaymedai` resource has `jmcgpt-astra` (`gpt-6-astra`, version `2026-09-03`, US DataZoneStandard) and embeddings/Anthropic deployments. The checked `JMCAzure` resource has Anthropic and embedding deployments. Neither checked resource has an image-generation or transcription deployment. The current model supports image input per Microsoft's model documentation; the new direct Azure OpenAI route still needs a live staging test and managed-identity data-role verification.

The clinic requires no provider content retention, in addition to no saved application history. `jaymedai` does not report `ContentLogging=false`. Microsoft's documentation says that flag appears only when storage for abuse monitoring has been turned off. The new production entrypoint checks the live resource on startup and before each inference; missing, enabled, unknown, or mismatched-resource status blocks sending content. It will not start against the current resource. The managed identity must have account-read permission for that check.

This necessary check is not a provider-wide zero-retention guarantee: the exact image/audio/chat feature terms and retention exceptions must also be verified. No saved app histories is different from the provider's monitoring policy. Modified abuse monitoring requires Microsoft approval; no application setting can grant that approval. The existing v1.1.1 app has not been granted a PHI/zero-retention approval by this work.

Microsoft's BAA applies through the applicable Product Terms/DPA for covered services. The clinic must verify its agreement, the exact model/API/region coverage (including any preview feature), and retention arrangements, and complete its risk assessment and operating procedures. A configured `JMCGPT_APPROVED_CAPABILITIES` value is an operator decision record, not evidence of compliance. Never enable a capability merely to bypass a startup error.

References:

- [HHS cloud computing guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html)
- [Microsoft HIPAA scope and shared responsibility](https://learn.microsoft.com/en-us/azure/compliance/offerings/offering-hipaa-us)
- [Foundry data privacy and modified abuse monitoring](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy)
- [Azure model capabilities](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure)

## Release procedure

1. Record the exact covered services, deployment versions, regions, retention policy, and clinic approval. Provision only the reviewed image/audio models. The image adapter requires an explicit reviewed API version; no default is enabled. A preview API/model must not be presumed eligible for PHI. Use a covered supported version, or leave that capability disabled. The audio adapter defaults to the GA 2024-10-21 deployment API; select a model/version supported by that API, or update and verify the adapter.
2. Configure `.env.secure.example` values in Container Apps. Use the managed identity; no API keys in browser code. Grant only required model invocation roles. Keep both content-tracing flags false.
3. Build with `docker build -f src/Dockerfile.secure -t <registry>/jmcgpt:2.0.0-rc.1 src/` from the repository root. Validate the resulting Linux image, including parser limits; use a read-only root filesystem where the runtime supports it, no writable PHI volumes, core dumps disabled, and appropriately limited memory/CPU. The default image uses one worker and allows two concurrent operations, with 20 operations/minute/staff user.
4. Deploy to an authenticated staging Container App. Preserve Easy Auth, HTTPS, exact approved origin, and the corrected unquoted redirect URL. Trust `x-ms-client-principal*` only from the Easy Auth sidecar; never expose the app port through an alternate route.
5. Test tenant/domain denial, each upload format, chat/vision/image generation/editing/audio, Stop, idle expiry, refresh, sign-out, and audit redaction using synthetic data. Test a second staff account. Confirm no browser persistence and no PHI in platform request traces. Verify provider/network access controls and tenant MFA policy.
6. Have the clinic's responsible security/privacy official review the deployment evidence, risk assessment, access procedures, incident response, workforce training, and security-record retention. Then promote the immutable tested image, with a documented rollback to v1.1.1. Do not label the app HIPAA-certified.

No GitHub Actions are needed. This local candidate has not changed Entra policy, provisioned model deployments, enabled preview services for PHI, or changed production traffic.
