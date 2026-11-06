import { describe, expect, it } from 'vitest';

import { defaultTitle, uploadType } from './files';

describe('uploadType', () => {
  it('accepts Markdown and PDF', () => {
    expect(uploadType('Handbook.MD')).toBe('text/markdown');
    expect(uploadType('report.pdf')).toBe('application/pdf');
  });

  it('refuses anything else', () => {
    expect(uploadType('page.html')).toBeNull();
    expect(uploadType('pdf')).toBeNull();
  });
});

describe('defaultTitle', () => {
  it('drops the extension and separators', () => {
    expect(defaultTitle('salary-bands_2026.md')).toBe('salary bands 2026');
  });
});
