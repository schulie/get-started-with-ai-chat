# JMCGPT release notes

## 1.1.1

Status: prepared; deployment and signed-in verification are pending.

- Fix valid chat requests rejected when a reverse proxy replaces Host or terminates TLS.
- Validate browser Origin against an explicitly configured public origin, without trusting forwarded host headers.
- Preserve authentication challenges and reject unapproved origins, schemes, ports and duplicate Origin headers.
- Distinguish expired authentication from forbidden requests in the UI.
- Allow an explicitly verified current image for upgrades while retaining the original pinned build base.

## 1.1.0

Deployed on 2026-10-19. Deployment health and traffic checks passed.
Signed-in interface verification remains pending.

- Response elapsed-time clock, processing status and retained completion duration.
- Stop, retry, regenerate, copy and message editing with conversation branching.
- Session history held in memory, cleared on New Chat, logout, page exit or inactivity.
- Responsive clinic interface and transient text/CSV/Markdown/JSON attachments.
- Bar, line and pie charts with data tables and SVG downloads.
- Sanitized errors, bounded requests, content-log redaction and minimal audit metadata.
- Visible application version and versioned build/deployment metadata.

No database or storage account is added. Image generation, voice, web search,
PDF/image analysis, Python execution and saved chat history are not enabled.
This release number does not certify HIPAA compliance.
