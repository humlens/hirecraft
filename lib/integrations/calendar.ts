import { ApiError } from '../errors';
import type { Fetch } from './oauth';

export type CalendarEventInput = {
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  /** staff only; candidates are invited through an approved message draft */
  attendees: string[];
  location?: string | null;
  withVideo: boolean;
};

export type CalendarAdapter = {
  createEvent(
    accessToken: string,
    input: CalendarEventInput
  ): Promise<{ id: string; meetingUrl: string | null }>;
  deleteEvent(accessToken: string, id: string): Promise<void>;
};

const auth = (t: string) => ({
  Authorization: `Bearer ${t}`,
  'Content-Type': 'application/json',
});

const fail = (what: string, status: number) =>
  new ApiError(502, `${what} failed (${status}).`);

export const googleCalendar = (
  f: Fetch = fetch,
  base = 'https://www.googleapis.com/calendar/v3'
): CalendarAdapter => ({
  async createEvent(token, i) {
    const r = await f(
      `${base}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
          summary: i.title,
          description: i.description,
          location: i.location ?? undefined,
          start: { dateTime: i.startsAt.toISOString() },
          end: { dateTime: i.endsAt.toISOString() },
          attendees: i.attendees.map((email) => ({ email })),
          ...(i.withVideo
            ? {
                conferenceData: {
                  createRequest: {
                    requestId: `hc-${i.startsAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' },
                  },
                },
              }
            : {}),
        }),
      }
    );

    if (!r.ok) throw fail('Google Calendar', r.status);

    const j = (await r.json()) as { id: string; hangoutLink?: string };

    return { id: j.id, meetingUrl: j.hangoutLink ?? null };
  },
  async deleteEvent(token, id) {
    const r = await f(
      `${base}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`,
      {
        method: 'DELETE',
        headers: auth(token),
      }
    );

    // already gone is fine
    if (!r.ok && r.status !== 404 && r.status !== 410)
      throw fail('Google Calendar', r.status);
  },
});

export const microsoftCalendar = (
  f: Fetch = fetch,
  base = 'https://graph.microsoft.com/v1.0'
): CalendarAdapter => ({
  async createEvent(token, i) {
    const r = await f(`${base}/me/events`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        subject: i.title,
        body: { contentType: 'text', content: i.description },
        start: {
          dateTime: i.startsAt.toISOString().replace('Z', ''),
          timeZone: 'UTC',
        },
        end: {
          dateTime: i.endsAt.toISOString().replace('Z', ''),
          timeZone: 'UTC',
        },
        location: i.location ? { displayName: i.location } : undefined,
        attendees: i.attendees.map((address) => ({
          emailAddress: { address },
          type: 'required',
        })),
        ...(i.withVideo
          ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' }
          : {}),
      }),
    });

    if (!r.ok) throw fail('Outlook Calendar', r.status);

    const j = (await r.json()) as {
      id: string;
      onlineMeeting?: { joinUrl?: string };
    };

    return { id: j.id, meetingUrl: j.onlineMeeting?.joinUrl ?? null };
  },
  async deleteEvent(token, id) {
    const r = await f(`${base}/me/events/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: auth(token),
    });

    if (!r.ok && r.status !== 404) throw fail('Outlook Calendar', r.status);
  },
});

export const calendarFor = (provider: string, f?: Fetch): CalendarAdapter =>
  provider === 'microsoft_calendar' ? microsoftCalendar(f) : googleCalendar(f);
