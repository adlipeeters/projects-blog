export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadType = 'text/markdown' | 'application/pdf';

/** By extension, because browsers report no type at all for many Markdown files. */
export function uploadType(fileName: string): UploadType | null {
  const name = fileName.toLowerCase();
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'text/markdown';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return null;
}

export function defaultTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}
