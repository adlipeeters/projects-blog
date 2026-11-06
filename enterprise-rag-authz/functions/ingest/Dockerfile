# Build from the repo root, after make writes build/requirements-ingest.txt.
FROM public.ecr.aws/lambda/python:3.13-arm64

COPY build/requirements-ingest.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt -t "${LAMBDA_TASK_ROOT}"

COPY shared/erag ${LAMBDA_TASK_ROOT}/erag
COPY functions/ingest/ingest.py functions/ingest/document_parser.py ${LAMBDA_TASK_ROOT}/

CMD ["ingest.handler"]
