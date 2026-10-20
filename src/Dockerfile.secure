FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
RUN npm install --global pnpm@10.6.0
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements-secure.txt ./
RUN pip install --no-cache-dir --upgrade pip==26.2.1 \
    && pip install --no-cache-dir --requirement requirements-secure.txt \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin jmcgpt
COPY api/__init__.py api/privacy.py api/secure_app.py api/secure_config.py api/uploads.py api/parse_worker.py api/azure_media.py api/web_reader.py ./api/
COPY api/video.py ./api/
COPY api/templates/ ./api/templates/
COPY api/static/ ./api/static/
COPY --from=frontend /build/api/static/react ./api/static/react
USER 10001
EXPOSE 50505
# One worker bounds parsing/inference concurrency without a shared session store.
CMD ["gunicorn", "api.secure_app:create_app()", "--bind", "0.0.0.0:50505", "--workers", "1", "--worker-class", "uvicorn.workers.UvicornWorker", "--timeout", "240", "--access-logfile", "/dev/null", "--error-logfile", "-", "--log-level", "warning"]
