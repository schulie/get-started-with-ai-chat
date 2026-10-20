# Current JMCGPT release

Release candidate: **2.0.0-beta.5**, October 19, 2026. See the deployment record in this directory for verified live revision and immutable image after rollout.

The active code is the bounded stateless API and React frontend, built using `src/Dockerfile.secure`. It includes the prior 403 origin fix, compact clinic branding, multimodal uploads, image generation/editing, explicit web search/page reading, short-video analysis, microphone dictation and device read-aloud. Video generation requires a supported provider connection; it is disabled. Microphone and local voice availability depend on the staff member's device/browser permission and installed voices.

46 backend and 29 frontend tests passed. The frontend TypeScript/Vite production build passed. Speech tests simulate microphone and local synthesis APIs and verify cleanup/late-response handling. The new API preserves authenticated tenant/domain access, exact origin checks, no-store responses, fixed audit metadata and bounded concurrency/rate/request size. No hardware microphone recording was captured during automated checks.

All beta inference is limited to synthetic/public/non-sensitive content. Provider zero-content-retention approval is pending. Do not describe this release as HIPAA certified or approved for PHI. Read `JMCGPT-SECURE-RELEASE.md` for production gates. The earlier candidate-status wording in that document describes the original secure candidate, not the live beta.

## Azure CLI release procedure

1. Sign in to the clinic's Azure tenant in the normal browser, preserving MFA. Select the intended subscription. Do not store authentication credentials or tokens in repository files.
2. Use a clean source context containing `src/`, excluding node_modules, virtual environments, caches and environment secret files. Run `az acr build --registry <registry> --image api_and_frontend:<version> --file Dockerfile.secure --platform linux/amd64 <clean-src-folder>`. No GitHub Actions are needed.
3. Confirm the ACR run succeeded and record the output image digest. Snapshot the existing Container App and authentication configuration. Preserve managed identity, registry access, ingress/custom domain, scaling and Easy Auth.
4. In multiple-revision mode, stage the tested image by immutable digest as a new revision with zero traffic. Preserve the old revision's 100% traffic. Supply the reviewed configuration from the examples. Do not enable PHI mode until its live provider-retention and contractual gates are met.
5. Require the staged revision to be Provisioned and Healthy. Verify nonroot startup, bounded isolated parsing and managed-identity inference using public/synthetic inputs.
6. Promote the healthy revision to 100% traffic. Verify the authenticated custom-domain browser, request completion and session clearing. Record the image digest, revision, configuration mode and checks. Deactivate the previous revision only after verification; retain it and its immutable image for rollback.

The original /chat HTTP 403 came from an Easy Auth redirect origin stored with literal quote characters. The allowed external redirect origin must be the exact unquoted public origin. No MFA policy changes were required.
