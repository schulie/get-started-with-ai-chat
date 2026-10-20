# JMCGPT beta with real Azure AI

The user authorized real Azure AI testing using synthetic/non-sensitive data while Microsoft's modified-abuse-monitoring request is pending. That application was submitted on October 19, 2026; submission is not approval. No PHI or confidential content may be used in this beta.

Configure a separate authenticated beta environment using the same tenant, domain, managed identity, and deployment settings as the secure example, with its own exact HTTPS public origin:

```
JMCGPT_DATA_MODE=non_sensitive_beta
JMCGPT_WEB_ENABLED=true
JMCGPT_APPROVED_CAPABILITIES=chat,vision,images,transcription
AZURE_OPENAI_IMAGE_DEPLOYMENT=jmcgpt-beta-image
AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT=jmcgpt-beta-audio
AZURE_OPENAI_IMAGE_API_VERSION=2025-04-01-preview
```

This beta provisions gpt-image-1-mini (2025-10-06, GlobalStandard capacity 1) and Whisper (001, Standard capacity 3) as separate beta deployments in jaymedai. These are usage-billed deployments; no provisioned-throughput commitment was selected. The image API is a preview API used only for non-sensitive testing. Retain both tracing settings as false. The beta must remain behind Easy Auth and tenant/domain checks, with MFA policy unchanged.

The beta explicitly permits Azure inference before modified-abuse-monitoring approval. It displays a persistent notice that Azure may retain content and requires a classification header for chat, uploads, and web requests. Beta.3 removes the optional acknowledgment checkbox at the clinic owner's explicit request. The header is a protocol marker, not a user attestation or automated PHI detector. Non-sensitive data remains a use restriction. No environment variable can turn non-sensitive testing into an approved PHI deployment.

The default `phi` mode still verifies the Azure retention flag at startup and before each inference. Unknown data modes fail closed. Web browsing is prohibited in PHI mode until a separate feature privacy review and implementation change. Do not relabel beta as compliant or silently promote its configuration to production.

## Public page reading

In Chat & analyze, enter a public HTTPS page URL and press Send. The server fetches text/HTML only and supplies extracted text and its final source URL to the model for citation. It forwards neither chat content nor uploads to the website. URL contents themselves are disclosed to the destination, so use only public, non-sensitive URLs without access tokens or credentials.

The reader blocks private, loopback, link-local, reserved and multicast addresses; validates all DNS answers used by its connector; checks every redirect; disables cookies, proxy environment variables, compressed responses and automatic redirects; and bounds time, bytes and extracted text. It does not run scripts, follow page links, log into websites, submit forms, bypass access controls, or download arbitrary files. Script-heavy sites and sites blocking automated readers may be unavailable. Page instructions are treated as untrusted source content.

Public search uses Azure Responses web_search through Bing, with store=false, background=false, no previous response ID, and no conversation or upload context. The response must include a completed search call and source URLs. Bing receives the current public query under its own terms, outside the Azure DPA/compliance boundary. Search is beta-only and usage-billed. The app reuses source text in browser memory for follow-ups. Citation correctness still needs human review. See beta.6 below for automatic routing; earlier releases required selecting Web.

Reference: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/web-search

Files and fetched page contents remain session-only. Existing refresh, New Chat, sign-out, Stop, and 15-minute idle clearing continue to apply. No external database or persistent upload storage was added.

## Validation and remaining deployment work

Backend tests cover default PHI retention enforcement, explicit beta configuration, classification and tenant boundaries, public URL validation, DNS and redirect defenses, HTML text extraction, and refusal to forward extra chat fields to the reader. Frontend tests cover beta acknowledgment and reusing fetched sources without another website request. Standard source/type checks and build checks also apply.

Live local provider tests used the signed-in Azure CLI identity. The Linux image was subsequently built through Azure Container Registry (no GitHub Actions), and staged with zero traffic. A check inside the running container verified nonroot execution, isolated CSV and scanned-PDF parsing under Linux limits, and real chat and web-search calls using the Container App managed identity. The signed-in website then returned a real search answer with a clickable source link. Thirty-six backend tests and twenty-three frontend tests passed; TypeScript and the production frontend build passed.

The beta was promoted at https://jmcgpt.jaymedical.com on October 19, 2026 (local Eastern time). The prior revision is retained for rollback. The production PHI retention requirement remains unsatisfied; this release is strictly non-sensitive beta testing. A second staff account, a container vulnerability scan, and the remaining clinic/security reviews are still required before PHI production use. No new dependencies were added beyond the previously audited candidate.

Image: crax6jwjezmywau.azurecr.io/api_and_frontend@sha256:7c9da70b1d52db9728335760bcb62056624d4ef4dab5c8bae70df703d924a4d7

The local synthetic-authentication test wrapper is excluded from both the deployment image and the source ZIP. The deployed factory continues to require Easy Auth and exact Jay Medical tenant/domain claims.

## Beta.2 interface update

The October 19 interface update replaces the separate web fields and image dropdown with Chat, Web, and Image buttons sharing one message box. Web sends only the explicitly entered public query, or reads a pasted public HTTPS URL, then returns to Chat for follow-ups. Chat history and files remain excluded from search. Pending files cannot be silently discarded by switching tools.

Uploads support drag-and-drop and image paste in addition to the attachment button. Files remain local until Send. The beta acknowledgment stays in memory and the retention warning remains visible in a compact line. The welcome screen and repeated status text were reduced to leave more room for answers.

Twenty-five frontend tests passed, including query separation, returning to Chat, local attachment handling, and preserving pending files. TypeScript, the production frontend build, a Linux ACR build, and a real Azure browser search check passed. No backend, model, identity, MFA, retention-policy, or persistent-storage changes were made by this interface update.

Beta.2 image: crax6jwjezmywau.azurecr.io/api_and_frontend@sha256:ce68a091b46c0fe6647f3f50e3a3b7b6edcf366fc697380886a70e47abca80a8

## Beta.3 branding update

At the clinic owner's request, the beta acknowledgment checkbox was removed while the compact no-patient-data and provider-retention notice remains. The header uses the existing red-and-gold Jay Medical logo from https://jaymedical.com/. The unchanged PNG is bundled under /static/jay-medical-logo.png and served from JMCGPT itself; browsers do not contact the clinic's website or its image CDN for the logo.

Logo source: https://img1.wsimg.com/isteam/ip/e8c62c61-8dcd-4ee9-b049-860e26befe56/logo/11f40af9-cf0a-44f1-92f4-f3365e411f3f.png/:/rs=w:226,h:134,cg:true,m/cr=w:226,h:134/qt=q:100/ll

The 25 frontend tests, TypeScript and production build passed. Authentication, MFA, session clearing, model deployments, and the production PHI retention checks are unchanged.

Beta.3 image: crax6jwjezmywau.azurecr.io/api_and_frontend@sha256:6e0c741df9e06bd782bbf4f7eb3c082da9d2eda5bd86347d4aed8a09a289c9f2

## Beta.6 automatic lookup (prepared, not deployed)

Auto is the default only when capabilities explicitly report both non_sensitive_beta and webEnabled. A browser-local rule routes standalone current-information questions (for example, weather, news, pricing, current events or an explicit lookup request) through the existing public search endpoint. A standalone public HTTPS URL without credentials, a query or fragment uses the existing public reader. Other questions use normal chat. Chat explicitly skips routing, and Web forces a user-selected public lookup. Web returns to Auto in this beta; no preference is persisted across sessions.

Automatic requests use only the current question or URL. Previous conversation messages, files and extracted file contents never enter that request. A message with files always uses chat. References to missing context, common identifiers and sensitive-data cues, opt-out language, transformation requests, and long/multiline text suppress automatic routing. This is deliberately conservative, rule-based routing, not a medical-data classifier, de-identification system or comprehensive intent detector. The beta's no-PHI/no-confidential-data restriction still applies to every mode. Contextual follow-ups can discuss cached source material without another search; submit a new standalone current question for a fresh lookup.

The clock shows Searching web or Reading public page while lookup runs. A failed search stops the request with Retry available; it does not silently answer from model memory. Stop and session clearing abort the lookup and reject late results. Regenerate reuses prepared sources. No extra routing model call, dependency, database, storage service, Azure resource or access permission is added. Azure search/model usage charges still apply. Provider indexed search can use cached content; the direct public page reader fetches the selected page at request time and does not support authenticated or script-only pages.
