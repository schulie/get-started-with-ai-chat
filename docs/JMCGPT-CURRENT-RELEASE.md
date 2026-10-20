# Current JMCGPT release

Source release: **2.0.0**, October 20, 2026.

The interface uses the stable JMCGPT name and version. Beta/test branding, the composer warning banner and the repeated answer-review footer have been removed. A compact “Public information only” label is shown when the server reports that data mode. The existing API value `non_sensitive_beta` is retained for configuration compatibility; this interface release does not change deployment data permissions or Azure provider-retention settings.

Phones use a compact header, two toolbar rows with 44-pixel tap targets, a shorter welcome area and a compact session footer. The conversation and composer scroll separately, long tables and code scroll within their containers, and settings fit narrow screens. Safe-area padding supports devices with display cutouts. The app follows VisualViewport height changes at normal zoom to accommodate an on-screen keyboard, with dynamic-viewport CSS as the fallback. Short viewports hide welcome suggestions and tool hints and reduce the message box height. Touch keyboard Return inserts a line; use Send to submit. Desktop Enter still sends, and Shift+Enter inserts a line.

Auto mode looks up eligible current-information questions using only the current question. A standalone public HTTPS URL without a query or fragment selects page reading. Chat skips lookup, and Web forces an explicit lookup. Files, contextual follow-ups, transformations, opt-out instructions, sensitive-data cues and long/multiline text suppress automatic routing. These are convenience routing rules. Chat, Stop, Retry, session clearing and cached-source reuse retain their existing request paths.

Validation: **44 frontend tests pass**, and TypeScript plus the Vite production build pass. New checks cover keyboard-related visible-height changes, resize events, listener cleanup, pinch-zoom fallback and touch Enter behavior. Existing chat, upload, speech and automatic-lookup checks also pass. The backend is unchanged and was not rerun. No dependencies were added. GitHub Actions and live provider calls were not used.

Visual phone/browser QA remains to be completed on the deployment. This workspace's preview browser could not reach its local development server and does not permit local file previews, so no viewport screenshot or device/keyboard verification is claimed. Check 320-pixel and 390-pixel phones, a short keyboard-open viewport, a tablet and desktop. Exercise all tool modes, long answers with code/tables, attachments, dictation controls, Settings and New Chat.

Deployment evidence: the user-supplied browser screenshot shows **2.0.0-beta.6** served at `https://jmcgpt.jaymedical.com`. This session has not deployed 2.0.0 or independently checked Azure revision health. The older beta.5 deployment record remains available in `JMCGPT-beta5-deployment.json` as historical evidence.

The active application is the stateless API and React frontend built with `src/Dockerfile.secure`. Deploy 2.0.0 from the updated source using the Azure CLI procedure below. Historical feature and configuration records remain in `JMCGPT-BETA.md`, `JMCGPT-VIDEO-BETA.md` and `JMCGPT-SPEECH-BETA.md`; provider/data-mode requirements are documented in `JMCGPT-SECURE-RELEASE.md`.

## Azure CLI release procedure

1. Sign in to the clinic's Azure tenant in the normal browser, preserving MFA. Select the intended subscription. Do not store authentication credentials or tokens in repository files.
2. Use a clean source context containing `src/`, excluding node_modules, virtual environments, caches and environment secret files. Run `az acr build --registry <registry> --image api_and_frontend:<version> --file Dockerfile.secure --platform linux/amd64 <clean-src-folder>`. No GitHub Actions are needed.
3. Confirm the ACR run succeeded and record the output image digest. Snapshot the existing Container App and authentication configuration. Preserve managed identity, registry access, ingress/custom domain, scaling and Easy Auth.
4. In multiple-revision mode, stage the tested image by immutable digest as a new revision with zero traffic. Preserve the old revision's 100% traffic. Supply the reviewed configuration from the examples. Do not enable PHI mode until its live provider-retention and contractual gates are met.
5. Require the staged revision to be Provisioned and Healthy. Verify nonroot startup, bounded isolated parsing and managed-identity inference using public/synthetic inputs.
6. Promote the healthy revision to 100% traffic. Verify the authenticated custom-domain browser, request completion and session clearing. Record the image digest, revision, configuration mode and checks. Deactivate the previous revision only after verification; retain it and its immutable image for rollback.

The original /chat HTTP 403 came from an Easy Auth redirect origin stored with literal quote characters. The allowed external redirect origin must be the exact unquoted public origin. No MFA policy changes were required.
