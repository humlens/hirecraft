import { ApiError } from './errors';

export const RESUME_TYPES: Record<string, { ext: string; magic: number[][] }> =
  {
    'application/pdf': { ext: 'pdf', magic: [[0x25, 0x50, 0x44, 0x46]] }, // %PDF
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      ext: 'docx',
      magic: [[0x50, 0x4b, 0x03, 0x04]], // PK.. (zip)
    },
  };

/**
 * Checks the declared MIME type against an allow-list AND the file's magic
 * bytes, so renaming an executable to .pdf does not pass.
 */
export function validateResume(buffer: Buffer, mime: string, maxBytes: number) {
  const type = RESUME_TYPES[mime];

  if (!type) {
    throw new ApiError(415, 'Only PDF and DOCX resumes are accepted.');
  }

  if (buffer.length === 0) {
    throw new ApiError(400, 'The file is empty.');
  }

  if (buffer.length > maxBytes) {
    throw new ApiError(
      413,
      `File too large (max ${Math.floor(maxBytes / 1024 / 1024)} MB).`
    );
  }

  const ok = type.magic.some((sig) => sig.every((b, i) => buffer[i] === b));

  if (!ok) {
    throw new ApiError(415, 'The file content does not match its type.');
  }

  return type.ext;
}

export type ScanResult = { clean: boolean; reason?: string };
export type Scanner = (
  buffer: Buffer,
  meta: { fileName: string; mime: string }
) => Promise<ScanResult>;

let scanner: Scanner = async () => ({ clean: true });

/** Plug in a virus scanner (e.g. ClamAV). The default allows everything. */
export const setUploadScanner = (s: Scanner) => {
  scanner = s;
};

export async function scanUpload(
  buffer: Buffer,
  meta: { fileName: string; mime: string }
) {
  const result = await scanner(buffer, meta);

  if (!result.clean) {
    throw new ApiError(422, 'The file was rejected by the virus scan.');
  }
}

/** Reads a request body stream with a hard size limit. */
export async function readBodyLimited(
  req: AsyncIterable<Buffer | string>,
  maxBytes: number
) {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;

    if (total > maxBytes) {
      throw new ApiError(
        413,
        `File too large (max ${Math.floor(maxBytes / 1024 / 1024)} MB).`
      );
    }

    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}
