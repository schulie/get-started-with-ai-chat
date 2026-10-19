# JMCGPT 1.1.0

Status: prepared; Azure deployment and live verification are pending.

The application uses semantic versions: MAJOR.MINOR.PATCH. New features increment
MINOR; fixes increment PATCH; incompatible changes increment MAJOR. This number
identifies the JMCGPT application, independently of its Azure model version.

`src/frontend/src/release.json` is the release version source. The footer, page
release marker, asset versions, image label, image tag, revision name and deployment
result use this value. Packaging rejects a mismatched frontend package version,
and the image build rejects a mismatched version argument. The deployment script
supplies that argument automatically. See [CHANGELOG.md](CHANGELOG.md) for scope.

This change keeps the clinic's deployed Azure model and managed identity, adds a
session-only chat UI, and introduces no database, storage account, model deployment,
role assignment, or external tool provider.

## Implemented behavior

- A monotonic response clock runs through processing and streaming. Completed,
  stopped and failed replies retain their duration.
- Stop aborts the active fetch/read. Every failure path releases the task state;
  a 4-minute application request timeout prevents an indefinite spinner.
- Retry reuses the original question once. Regenerate replaces the last reply.
  Editing an earlier question branches from that point. Prior replies are sent
  with the assistant role.
- New Chat, logout, page exit and inactivity clear in-memory conversation state
  and cancel its request. Late events cannot enter a subsequent chat. Nothing
  writes conversation text to localStorage, sessionStorage, IndexedDB or cookies.
  Theme preferences remain independent. The default chat inactivity window is
  15 minutes in `useChatSession.ts`; this is an application setting, not a claim
  that HIPAA specifies a particular timeout. Existing Entra session policy is
  unchanged.
- A controlled mobile composer supports Enter, Shift+Enter, input method editors,
  starter drafts, and local TXT/MD/CSV/JSON attachment parsing. The user presses
  Send before extracted text is transmitted. Each attachment is limited to
  256 KB; combined message content is bounded. Files are not archived.
- A fenced `chart` JSON schema renders bar, line and pie charts as fixed SVG
  components. Charts include a data table and local SVG download. Generated
  JavaScript, HTML or Python is not executed.
- Safe same-origin media paths support inline images/video/audio/PDF previews.
  External model-written image URLs are links instead of automatic network
  requests. No auth endpoints can be used as automatic media sources.
- Frontend content debug logs are removed. Backend route/main log arguments are
  redacted, provider failures use fixed SSE error events, validation error
  bodies are sanitized, and chat responses/pages receive no-store headers.
- The chat request body is bounded. Cross-origin browser posts and client-supplied
  system roles are rejected. Existing authentication remains in place. Minimal
  audit events contain a request ID, a validated identity GUID when available,
  status and elapsed time, with no prompts, answers, query strings or filenames.

## Deliberately not enabled

This release does not activate public web search, image generation, voice,
Python/code-execution services, PDF parsing, image uploads/vision, saved histories,
public sharing, or background job recovery. These require additional integration
and, when PHI is involved, verification of the exact service's contractual scope,
data processing and retention. A chart renderer is not an image-generation model
or a numerical computation engine.

The inherited Astra adapter continues to use `store=false` and the existing Azure
AI HTTPS host with managed identity. The existing clinic system instruction and
retrieved document context are preserved; an application-capability instruction
is appended to describe charts and prevent claims of unavailable tools.

Session-only UI behavior and `store=false` do not establish zero upstream
retention or HIPAA compliance. Existing Azure telemetry, service retention,
contracts, identity policy, and access to the resource must still be reviewed.
No patient data is used by the included tests.

## Build and deploy

The target is the existing Container App `ca-api-ax6jwjezmywau` in `rg-jmcai`,
serving `https://jmcgpt.jaymedical.com/`. The base is the prior verified Astra
image, pinned by digest in the Dockerfile. Runtime frontend dependencies,
branding files, backend instructions, model, infrastructure and authentication
are inherited. An explicit packaging allowlist overlays only intended files.
The backend patch refuses an unexpected route source hash or handler shape.

Run checks from the repository root:

```bash
cd src/frontend
npm exec --yes --package=pnpm@10.6.0 -- pnpm install --frozen-lockfile --ignore-scripts
npm test
npm run build
cd ../..
PYTHONPATH=deploy/jmcgpt-session python -m unittest discover -s deploy/jmcgpt-session/tests -v
python deploy/jmcgpt-session/package.py --output /tmp/jmcgpt-session-context.tar.gz
```

Python tests need `httpx==0.28.1`, which is a test dependency and is already
present in the deployed model runtime. No runtime Python dependency is added.

In an authenticated Azure CLI environment, build without activation:

```bash
python deploy/jmcgpt-session/deploy.py
```

Build and activate after the checks:

```bash
python deploy/jmcgpt-session/deploy.py --activate
```

The script verifies the target domain, current immutable image and model before
building. Activation changes only the `main` container image and revision suffix.
Configuration, identity, authentication and remaining template fields are hashed
before and after. It never calls provisioning or changes service permissions.
The Docker build runs the backend patch checks/tests against the pinned runtime.

The manual `Deploy JMCGPT session release` workflow uses Azure OIDC. It requires
the existing repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and
`AZURE_SUBSCRIPTION_ID`, plus the existing Azure federated credential and deployment
permissions. Missing values fail immediately instead of attempting interactive
login. Automatic application deployment is not enabled by this change.

The local source tests and production frontend build can be verified without Azure.
A complete overlay image build and live authentication/response check require
access to the existing Azure subscription and registry. Do not report this release
as live until the new healthy revision and custom-domain interaction are verified.

## Rollback

Use the same existing Container App and restore the pinned previous image:

```bash
az containerapp update --name ca-api-ax6jwjezmywau --resource-group rg-jmcai \
  --container-name main \
  --image crax6jwjezmywau.azurecr.io/api_and_frontend@sha256:04262c42bbca8f4ec9c8e4c03849c5a7f494cd0fa7e4b24d6830865a5a3bac8e \
  --revision-suffix rollback-session
```

The previous model deployment and images are retained. No records or resources are
deleted by deployment or rollback.
