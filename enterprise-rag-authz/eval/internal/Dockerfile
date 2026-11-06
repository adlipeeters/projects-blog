# Build from the repo root, after make writes build/requirements-eval.txt.
FROM python:3.13-slim

ENV PYTHONPATH=/app PYTHONUNBUFFERED=1 MANIFEST_PATH=/app/manifest.json

COPY build/requirements-eval.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY shared/erag /app/erag
COPY eval/internal/access_matrix.py scripts/personas.py corpus/manifest.json /app/

USER nobody
CMD ["python", "/app/access_matrix.py"]
