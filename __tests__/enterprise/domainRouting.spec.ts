/**
 * @jest-environment node
 */
import { customDomainAction, isPlatformHost } from '../../lib/domainRouting';
import {
  googleCalendar,
  microsoftCalendar,
} from '../../lib/integrations/calendar';
import { webhookPartner, signBody } from '../../lib/integrations/partners';

describe('custom domain routing (pure)', () => {
  const a = (p: string) => customDomainAction(p, 'acme');

  it('recognises the platform itself', () => {
    const hosts = ['app.example.com'];

    expect(isPlatformHost('app.example.com:443', hosts, 'platform.test')).toBe(
      true
    );
    expect(isPlatformHost('localhost:4002', hosts, '')).toBe(true);
    expect(isPlatformHost('127.0.0.1', hosts, '')).toBe(true);
    expect(
      isPlatformHost('careers.platform.test', hosts, 'platform.test')
    ).toBe(true);
    expect(isPlatformHost('', hosts, '')).toBe(true);
    expect(isPlatformHost('careers.acme.com', hosts, 'platform.test')).toBe(
      false
    );
    expect(isPlatformHost('evilplatform.test', hosts, 'platform.test')).toBe(
      false
    ); // not a sub-domain
  });

  it('serves the portal under short URLs', () => {
    expect(a('/')).toEqual({ kind: 'rewrite', to: '/p/acme' });
    expect(a('/jobs')).toEqual({ kind: 'rewrite', to: '/p/acme/jobs' });
    expect(a('/jobs/')).toEqual({ kind: 'rewrite', to: '/p/acme/jobs' });
    expect(a('/jobs/senior-engineer')).toEqual({
      kind: 'rewrite',
      to: '/p/acme/jobs/senior-engineer',
    });
    expect(a('/about')).toEqual({ kind: 'rewrite', to: '/p/acme/about' });
    expect(a('/sitemap.xml')).toEqual({
      kind: 'rewrite',
      to: '/p/acme/sitemap.xml',
    });
    expect(a('/robots.txt')).toEqual({
      kind: 'rewrite',
      to: '/p/acme/robots.txt',
    });
  });

  it("lets assets, public APIs and the portal's own pages through", () => {
    for (const p of [
      '/_next/static/x.js',
      '/icons/icon-192.png',
      '/api/public/portals/acme/jobs',
      '/sw.js',
      '/manifest.webmanifest',
      '/offline.html',
      '/p/acme',
      '/p/acme/jobs/x',
    ]) {
      expect(a(p)).toEqual({ kind: 'pass' });
    }
  });

  it('sends sign-in, apply and app pages to the platform host, and never serves another portal', () => {
    for (const p of [
      '/p/acme/apply/job',
      '/me',
      '/me/applications',
      '/auth/login',
      '/teams/acme/jobs',
      '/dashboard',
      '/api/teams/acme/jobs',
      '/api/auth/session',
      '/admin',
    ]) {
      expect(a(p)).toEqual({ kind: 'redirect' });
    }

    expect(a('/p/other')).toEqual({ kind: 'notfound' });
    expect(a('/p/other/jobs')).toEqual({ kind: 'notfound' });
    expect(a('/p/acmeevil')).toEqual({ kind: 'notfound' });
  });
});

describe('calendar adapters (request contract)', () => {
  const seen: { url: string; init: any }[] = [];
  const mk = (reply: unknown, status = 200) =>
    (async (url: any, init: any) => {
      seen.push({ url: String(url), init });

      return { ok: status < 400, status, json: async () => reply } as Response;
    }) as typeof fetch;
  const input = {
    title: 'Interview: Ada',
    description: 'http://app/teams/a/interviews/1',
    startsAt: new Date('2026-12-01T10:00:00Z'),
    endsAt: new Date('2026-12-01T10:45:00Z'),
    attendees: ['hm@acme.test'],
    withVideo: true,
  };

  beforeEach(() => (seen.length = 0));

  it('Google: creates the event with a Meet request and deletes it', async () => {
    const g = googleCalendar(
      mk({ id: 'e1', hangoutLink: 'https://meet.google.com/x' }),
      'https://gcal.test/v3'
    );
    const r = await g.createEvent('tok', input);

    expect(r).toEqual({ id: 'e1', meetingUrl: 'https://meet.google.com/x' });
    expect(seen[0].url).toBe(
      'https://gcal.test/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all'
    );
    expect(seen[0].init.headers.Authorization).toBe('Bearer tok');

    const body = JSON.parse(seen[0].init.body);

    expect(body).toMatchObject({
      summary: 'Interview: Ada',
      start: { dateTime: '2026-12-01T10:00:00.000Z' },
      attendees: [{ email: 'hm@acme.test' }],
    });
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe(
      'hangoutsMeet'
    );

    await g.deleteEvent('tok', 'a/b');
    expect(seen[1]).toMatchObject({
      url: 'https://gcal.test/v3/calendars/primary/events/a%2Fb?sendUpdates=all',
    });
    expect(seen[1].init.method).toBe('DELETE');
  });

  it('Google: a missing event is fine to delete, other errors are reported without vendor detail', async () => {
    await expect(
      googleCalendar(mk({}, 404), 'https://x').deleteEvent('t', 'e')
    ).resolves.toBeUndefined();
    await expect(
      googleCalendar(mk({}, 410), 'https://x').deleteEvent('t', 'e')
    ).resolves.toBeUndefined();
    await expect(
      googleCalendar(
        mk({ error: 'secret vendor text' }, 500),
        'https://x'
      ).createEvent('t', input)
    ).rejects.toMatchObject({
      status: 502,
      message: 'Google Calendar failed (500).',
    });
  });

  it('Microsoft: creates a Teams meeting in UTC and returns the join link', async () => {
    const ms = microsoftCalendar(
      mk({
        id: 'm1',
        onlineMeeting: { joinUrl: 'https://teams.microsoft.com/j' },
      }),
      'https://graph.test/v1.0'
    );
    const r = await ms.createEvent('tok', { ...input, location: 'HQ' });

    expect(r).toEqual({
      id: 'm1',
      meetingUrl: 'https://teams.microsoft.com/j',
    });
    expect(seen[0].url).toBe('https://graph.test/v1.0/me/events');

    const body = JSON.parse(seen[0].init.body);

    expect(body).toMatchObject({
      subject: 'Interview: Ada',
      start: { dateTime: '2026-12-01T10:00:00.000', timeZone: 'UTC' },
      location: { displayName: 'HQ' },
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
      attendees: [
        { emailAddress: { address: 'hm@acme.test' }, type: 'required' },
      ],
    });
  });

  it('without video no meeting is requested', async () => {
    await googleCalendar(mk({ id: 'e' }), 'https://x').createEvent('t', {
      ...input,
      withVideo: false,
    });
    await microsoftCalendar(mk({ id: 'e' }), 'https://x').createEvent('t', {
      ...input,
      withVideo: false,
    });
    expect(JSON.parse(seen[0].init.body).conferenceData).toBeUndefined();
    expect(JSON.parse(seen[1].init.body).isOnlineMeeting).toBeUndefined();
  });
});

describe('partner webhook adapter', () => {
  const req = {
    kind: 'assessment' as const,
    applicationId: 'a1',
    candidate: { name: 'Ada', email: 'ada@x.test' },
    job: { title: 'Eng' },
    consentConfirmed: false,
  };

  it('signs the exact body it sends and refuses redirects', async () => {
    let init: any;
    const p = webhookPartner(
      { url: 'https://partner.test/h', secret: 'sekret-sekret-sekret' },
      (async (_u: any, i: any) => {
        init = i;

        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'x9' }),
        } as Response;
      }) as typeof fetch
    );

    expect(await p.request(req)).toEqual({
      externalId: 'x9',
      status: 'REQUESTED',
    });
    expect(init.headers['X-Hirecraft-Signature']).toBe(
      signBody('sekret-sekret-sekret', init.body)
    );
    expect(init.redirect).toBe('error');
  });

  it('never sends a background check without confirmed consent', async () => {
    const f = jest.fn();
    const p = webhookPartner(
      { url: 'https://partner.test/h', secret: 's'.repeat(20) },
      f as never
    );

    await expect(
      p.request({ ...req, kind: 'background_check' })
    ).rejects.toMatchObject({ status: 422 });
    expect(f).not.toHaveBeenCalled();
  });
});
