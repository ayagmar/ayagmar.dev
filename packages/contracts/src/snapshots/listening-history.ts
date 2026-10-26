import { z } from 'zod';
import { envelopeSchema } from '../envelope.ts';

// "On this day" in listening (ADR 0030): for today's date in Rabat, what min7_ scrobbled on
// the same date in each past year since the Last.fm account was registered.

// Wire input: Last.fm API 2.0 JSON. Only the fields the normalizer reads are declared; zod
// drops every other key, the profile fields of `user.getInfo` included. Numbers come as strings.

const digits = z.string().regex(/^\d{1,12}$/);

/** `user.getInfo`: only the registration time is read. */
export const lastfmUserInfoSchema = z.object({
  user: z.object({ registered: z.object({ unixtime: digits }) }),
});

/** Scrobbles per `user.getRecentTracks` page: Last.fm's maximum. */
export const historyPageLimit = 200;

/**
 * One scrobble. A finished one has `date.uts`; the track playing now has
 * `@attr.nowplaying` and no date, and is not counted.
 */
export const lastfmScrobbleSchema = z.object({
  name: z.string().max(1024),
  artist: z.object({ '#text': z.string().max(1024) }),
  date: z.object({ uts: digits }).optional(),
  '@attr': z.object({ nowplaying: z.string().max(16).optional() }).optional(),
});

/**
 * A `user.getRecentTracks` page with `limit=200`, `page` and `from`/`to`. A list of one is a
 * bare object, an empty one `[]`, and the track playing now can come on top of a full page.
 * Unlike the listening schema, items are checked here: a scrobble that cannot be read fails
 * the pull rather than being skipped, since a skipped one would change the counts.
 */
export const lastfmHistoryPageSchema = z.object({
  recenttracks: z.object({
    track: z.union([z.array(lastfmScrobbleSchema).max(historyPageLimit + 1), lastfmScrobbleSchema]),
    '@attr': z.object({
      user: z.string().max(64),
      page: digits,
      perPage: digits,
      totalPages: digits,
      total: digits,
    }),
  }),
});

// Normalized output: what `/v1/listening-history` serves.

/**
 * A real Gregorian calendar date, `YYYY-MM-DD`: months of 30 and 31 days, and 29 February
 * only in leap years (every fourth year, but of the century years only those divisible by
 * 400). A pattern, so that validators in other languages reject `2025-02-29` too.
 */
export const calendarDatePattern =
  /^(?:\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8]))|(?:\d{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)$/;

/** Last.fm opened in 2002; no scrobble or account is older. */
const year = z.int().min(2002).max(9999);

/** Past years one pull reads at most: one request each, plus discovery (ADR 0030). */
export const historyMaxYears = 24;

const text = z.string().min(1).max(1024);

export const listeningHistorySnapshotSchema = z.object({
  /** The date in Rabat (Africa/Casablanca) this snapshot is for. Show it on no other date. */
  describedDate: z.string().regex(calendarDatePattern),
  /**
   * The year the account was registered, in Rabat. Every year from it to the year before
   * `describedDate` was read; those not in `years` had no scrobbles on that date.
   */
  firstYear: year,
  /** Past years with at least one scrobble on that date, newest first, each once. */
  years: z
    .array(
      z.object({
        year,
        /** Scrobbles on that day in Rabat, as Last.fm counted them when fetched. */
        scrobbles: z.int().min(1).max(1_000_000),
        /**
         * Scrobbles read to find the top track. Equal to `scrobbles` when the whole day was
         * read; fewer when the pull's page budget cut it short, and then `top` is only the
         * most played among those read: the day's own top track may differ.
         */
        read: z.int().min(1).max(1_000_000),
        /**
         * The most played track among those read: an exact artist and title, after trimming
         * spaces at either end. Ties go to the track scrobbled first that day, then by artist
         * and title in code point order.
         */
        top: z.object({ track: text, artist: text, plays: z.int().min(1).max(1_000_000) }),
      })
    )
    .max(historyMaxYears),
});

export type ListeningHistorySnapshot = z.infer<typeof listeningHistorySnapshotSchema>;

/** The `/v1/listening-history` response. */
export const listeningHistoryEnvelopeSchema = envelopeSchema(
  z.literal('listening-history'),
  listeningHistorySnapshotSchema
);
