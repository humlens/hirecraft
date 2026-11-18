/**
 * @jest-environment node
 */
import { createMocks } from 'node-mocks-http';

process.env.CRON_SECRET = 'cron-secret-for-tests';

const run = jest.fn(async () => ({ jobsPublished: 0 }));

jest.mock('@/lib/ticker', () => ({ runDueTasks: () => run() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const handler = require('../../pages/api/internal/cron').default;

const call = async (method: string, authorization?: string) => {
  const { req, res } = createMocks({
    method: method as never,
    headers: authorization ? { authorization } : {},
  });

  await handler(req, res);

  return {
    status: res._getStatusCode(),
    json: res._getData() ? JSON.parse(res._getData()) : undefined,
  };
};

describe('GET /api/internal/cron (Vercel Cron)', () => {
  beforeEach(() => run.mockClear());

  it('runs the due tasks for the right bearer secret', async () => {
    const r = await call('GET', 'Bearer cron-secret-for-tests');

    expect(r.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses a missing or wrong secret and other methods', async () => {
    expect((await call('GET')).status).toBe(401);
    expect((await call('GET', 'Bearer nope')).status).toBe(401);
    expect((await call('POST', 'Bearer cron-secret-for-tests')).status).toBe(
      405
    );
    expect(run).not.toHaveBeenCalled();
  });
});
