# The verified Astra release includes the clinic's UI, model and managed-identity adapter.
FROM crax6jwjezmywau.azurecr.io/api_and_frontend@sha256:04262c42bbca8f4ec9c8e4c03849c5a7f494cd0fa7e4b24d6830865a5a3bac8e AS deployed
FROM node:22-bookworm-slim AS frontend_builder
WORKDIR /code/frontend
COPY --from=deployed /code/frontend/ ./
RUN npm install --global pnpm@10.6.0 --ignore-scripts --no-audit --no-fund
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts
# The context contains an explicit allowlist, preserving deployed App/branding files.
COPY frontend/src/ ./src/
RUN pnpm build

FROM deployed AS checked
ARG JMCGPT_VERSION
COPY --from=frontend_builder /code/api/static/react/ /code/api/static/react/
COPY release.json /code/jmcgpt-release.json
COPY privacy.py azure_openai_chat.py /code/api/
COPY patch_runtime.py patch_page.py /tmp/jmcgpt-session-check/
COPY tests/ /tmp/jmcgpt-session-check/tests/
RUN python /tmp/jmcgpt-session-check/patch_runtime.py \
 && python /tmp/jmcgpt-session-check/patch_page.py \
 && python -m py_compile /code/api/main.py /code/api/routes.py /code/api/privacy.py /code/api/azure_openai_chat.py \
 && PYTHONPATH=/code/api:/tmp/jmcgpt-session-check python -m unittest discover -s /tmp/jmcgpt-session-check/tests -v

FROM deployed
ARG JMCGPT_VERSION
LABEL org.opencontainers.image.title="JMCGPT" \
      org.opencontainers.image.version="${JMCGPT_VERSION}"
COPY --from=checked /code/jmcgpt-release.json /code/jmcgpt-release.json
COPY --from=checked /code/api/main.py /code/api/main.py
COPY --from=checked /code/api/routes.py /code/api/routes.py
COPY --from=checked /code/api/privacy.py /code/api/privacy.py
COPY --from=checked /code/api/azure_openai_chat.py /code/api/azure_openai_chat.py
COPY --from=checked /code/api/static/react/ /code/api/static/react/
COPY --from=checked /code/api/templates/index.html /code/api/templates/index.html
COPY frontend/src/ /code/frontend/src/
