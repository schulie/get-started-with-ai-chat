# Current JMCGPT release

Prepared release: **2.0.0-beta.6**, October 20, 2026. Deployment and signed-in verification of beta.6 are pending. The latest recorded live release is **2.0.0-beta.5**; its deployment evidence is unchanged.

Beta.6 adds a default Auto mode in the explicitly enabled non-sensitive web beta. Current-information questions automatically search using only their current text; a standalone public HTTPS URL without a query/fragment selects page reading. Chat is the opt-out and Web remains the explicit lookup option. Rules suppress automatic lookup for files, contextual follow-ups, transformations, opt-out instructions, common sensitive-data cues and long/multiline inputs. These convenience rules are not a PHI detector and do not authorize sensitive data. Search/read progress is visible. Ordinary chat, Stop, Retry, session clearing and source reuse keep the same request path.

No backend, authentication, model, retention-policy or storage change is included. No dependency is added; the transitive baseline-browser-mapping metadata package is pinned to 2.11.29 (October 15) because 2.11.30 is too recent for the build environment's release-age policy. Apply the existing Azure CLI release procedure below using the reviewed source branch and beta.6 image tag. Do not use the legacy 1.1 overlay deployment script. Run tests and the frontend production build before staging.

The active code is the bounded stateless API and React frontend, built using `src/Dockerfile.secure`. It includes the prior 403 origin fix, compact clinic branding, multimodal uploads, image generation/editing, explicit web search/page reading, short-video analysis, microphone dictation and device read-aloud. Video generation requires a supported provider connection; it is disabled. Microphone and local voice availability depend on the staff member's device/browser permission and installed voices.

Beta.6 validation: all 40 frontend tests and the TypeScript/Vite production build pass locally. Tests exercise repeated automatic lookups, explicit Chat opt-out, beta gating, current-query isolation, file exclusion, source reuse, failed-lookup retry and rejecting late results after session clearing. The backend is unchanged and was not rerun for this frontend release. GitHub Actions and live provider tests were not used.

Beta.5's recorded validation was 46 backend and 29 frontend tests plus the production frontend build. Speech tests simulate microphone and local synthesis APIs and verify cleanup/late-response handling. The API preserves authenticated tenant/domain access, exact origin checks, no-store responses, fixed audit metadata and bounded concurrency/rate/request size. No hardware microphone recording was captured during automated checks.

All beta inference is limited to synthetic/public/non-sensitive content. Provider zero-content-retention approval is pending. Do not describe this release as HIPAA certified or approved for PHI. Read `JMCGPT-SECURE-RELEASE.md` for production gates. The earlier candidate-status wording in that document describes the original secure candidate, not the live beta.

## Azure CLI release procedure

1. Sign in to the clinic's Azure tenant in the normal browser, preserving MFA. Select the intended subscription. Do not store authentication credentials or tokens in repository files.
2. Use a clean source context containing `src/`, excluding node_modules, virtual environments, caches and environment secret files. Run `az acr build --registry <registry> --image api_and_frontend:<version> --file Dockerfile.secure --platform linux/amd64 <clean-src-folder>`. No GitHub Actions are needed.
3. Confirm the ACR run succeeded and record the output image digest. Snapshot the existing Container App and authentication configuration. Preserve managed identity, registry access, ingress/custom domain, scaling and Easy Auth.
4. In multiple-revision mode, stage the tested image by immutable digest as a new revision with zero traffic. Preserve the old revision's 100% traffic. Supply the reviewed configuration from the examples. Do not enable PHI mode until its live provider-retention and contractual gates are met.
5. Require the staged revision to be Provisioned and Healthy. Verify nonroot startup, bounded isolated parsing and managed-identity inference using public/synthetic inputs.
6. Promote the healthy revision to 100% traffic. Verify the authenticated custom-domain browser, request completion and session clearing. Record the image digest, revision, configuration mode and checks. Deactivate the previous revision only after verification; retain it and its immutable image for rollback.

The original /chat HTTP 403 came from an Easy Auth redirect origin stored with literal quote characters. The allowed external redirect origin must be the exact unquoted public origin. No MFA policy changes were required.
