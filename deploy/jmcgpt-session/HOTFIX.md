# JMCGPT 1.1.1

Status: prepared. Deployment and signed-in request verification are pending.

The 1.1.0 middleware compared browser Origin with the backend Host header.
A reverse proxy can replace Host and terminate TLS, causing a valid browser
request to receive HTTP 403 before reaching the chat backend. This failure
path was reproduced with synthetic requests. The production failure's exact
status/source has not yet been independently inspected.

The UI also treated every HTTP 403 as an expired sign-in. Version 1.1.1
uses the explicitly configured public origin for comparison and distinguishes
authentication failures from rejected origins and other forbidden requests.
It rejects other origins, schemes and ports, malformed or duplicate Origin
headers, and spoofed forwarded host headers. Downstream authentication still
runs and its HTTP 401 challenges remain intact.

The deployment script supplies `JMCGPT_PUBLIC_ORIGIN` as a build argument,
after verifying the existing app's public domain. The image retains this
value as an environment setting; no Azure authentication setting is changed.

For an upgrade, pass the verified current immutable image using
`--expected-current-image`, together with `--activate`. The script refuses a
different current image, keeps the pinned original build base, and rechecks
configuration, identity, authentication and revision health before reporting
activation. The actual previous live image is returned as `rollback_image`.

This patch adds no database, storage account, external tool or permission.
