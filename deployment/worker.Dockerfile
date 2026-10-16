FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app
COPY deployment/worker-requirements.lock ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --uid 10001 --create-home worker
# Copy Python source only; credentials, captures and local virtualenv stay out.
COPY services/ai/*.py ./
COPY services/ai/providers/*.py ./providers/
COPY services/ai/sources/*.py ./sources/
RUN mkdir /work && chown worker:worker /work
USER worker
WORKDIR /work
# Production scheduler starts collection/extraction on startup; use --help for a safe smoke check.
ENTRYPOINT ["python", "/app/worker_schedule.py"]
