# Build from the repo root, after make writes build/requirements-api.txt.
FROM python:3.13-slim

ENV PYTHONPATH=/app PYTHONUNBUFFERED=1

COPY build/requirements-api.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY shared/erag /app/erag
COPY api/erag_api /app/erag_api

USER nobody
EXPOSE 8000
CMD ["uvicorn", "erag_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
