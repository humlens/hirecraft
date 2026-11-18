/**
 * @jest-environment node
 */
import { extractResumeText } from '../../models/ai/resumeParse';
import { makeDocx, makePdf } from '../helpers/files';

describe('resume text extraction', () => {
  it('reads a PDF', async () => {
    const text = await extractResumeText(
      makePdf([
        'Jane Doe',
        'Senior Engineer, Acme, 2019-03 to present',
        'Skills: Node.js (TypeScript), PostgreSQL',
      ]),
      'application/pdf'
    );

    expect(text).toContain('Senior Engineer, Acme, 2019-03 to present');
    expect(text).toContain('Skills: Node.js (TypeScript), PostgreSQL');
  });

  it('reads a DOCX', async () => {
    const text = await extractResumeText(
      await makeDocx([
        'Jane Doe',
        'Engineer at Beta, 2016-01 to 2019-02',
        'AT&T <b>',
      ]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );

    expect(text).toContain('Engineer at Beta, 2016-01 to 2019-02');
    expect(text).toContain('AT&T <b>');
  });

  it('returns (almost) nothing for a PDF without text', async () => {
    const text = await extractResumeText(makePdf(['']), 'application/pdf');

    expect(text.replace(/--\s*\d+ of \d+\s*--/g, '').trim()).toBe('');
  });

  it('caps very long documents', async () => {
    const text = await extractResumeText(
      await makeDocx(
        Array.from(
          { length: 2000 },
          (_, i) =>
            `Line number ${i} with some padding text to make it long enough`
        )
      ),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );

    expect(text.length).toBeLessThanOrEqual(30000);
  });
});
