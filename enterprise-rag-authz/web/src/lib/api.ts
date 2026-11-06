import { SseParser, type ServerEvent } from './sse';
import type { UploadType } from './files';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Me {
  tenant_id: string;
  groups: string[];
  read_groups: string[];
  questions_left_today: number;
  tokens_left_today: number;
}

export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'INDEXED' | 'FAILED' | 'DELETING';

export interface DocumentRecord {
  doc_id: string;
  title: string;
  content_type: string;
  size: number;
  allowed_groups: string[];
  status: DocumentStatus;
  chunk_count: number;
  error: string | null;
  created_at: string;
}

export interface RetrievedDocument {
  number: number;
  doc_id: string;
  title: string;
  heading_path: string;
  page: number | null;
  score: number;
  text: string;
}

interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
}

async function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : response.statusText;
    throw new ApiError(response.status, detail);
  }
  return response;
}

export async function getMe(token: string): Promise<Me> {
  return (await (await request(token, '/api/me')).json()) as Me;
}

export async function listDocuments(token: string): Promise<DocumentRecord[]> {
  return (await (await request(token, '/api/admin/documents')).json()) as DocumentRecord[];
}

export async function deleteDocument(token: string, docId: string): Promise<void> {
  await request(token, `/api/admin/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
}

export async function uploadDocument(
  token: string,
  file: File,
  title: string,
  contentType: UploadType,
  allowedGroups: string[],
): Promise<void> {
  const response = await request(token, '/api/admin/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      content_type: contentType,
      size: file.size,
      allowed_groups: allowedGroups,
    }),
  });
  const { upload } = (await response.json()) as { upload: PresignedUpload };

  const form = new FormData();
  Object.entries(upload.fields).forEach(([name, value]) => form.append(name, value));
  // S3 reads the fields up to the file and ignores everything after it, so the file goes last.
  form.append('file', file);
  const stored = await fetch(upload.url, { method: 'POST', body: form });
  if (!stored.ok) throw new ApiError(stored.status, 'S3 refused the file');
}

export async function streamChat(
  token: string,
  question: string,
  onEvent: (event: ServerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await request(token, '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!response.body) throw new ApiError(500, 'the response has no body');

  const parser = new SseParser();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    parser.feed(value).forEach(onEvent);
  }
}
