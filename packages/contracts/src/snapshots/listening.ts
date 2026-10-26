import { z } from 'zod';
import { envelopeSchema, timestampSchema } from '../envelope.ts';

// Wire input: Last.fm API 2.0 JSON as the adapter receives it. Only the fields the
// normalizer reads are declared; zod drops every other key. Last.fm sends numbers as strings.

const countString = z.string().regex(/^\d{1,12}$/);

const lastfmText = z.object({ '#text': z.string().max(1024) });

/** One `recenttracks.track` item. The now-playing track has `@attr.nowplaying` and no `date`. */
export const lastfmTrackSchema = z.object({
  name: z.string().max(1024),
  artist: lastfmText,
  album: lastfmText.optional(),
  url: z.string().max(2048).optional(),
  date: z.object({ uts: countString }).optional(),
  '@attr': z.object({ nowplaying: z.string().max(16).optional() }).optional(),
});

const lastfmPageAttr = z.object({ total: countString });

/**
 * A Last.fm list: an array, or a bare object for a list of one; `[]` when empty. Items are
 * left unread here and checked one by one by the normalizer, which skips one it cannot read
 * instead of failing the whole list.
 */
const lastfmItems = z.union([z.array(z.unknown()).max(50), z.record(z.string(), z.unknown())]);

export const lastfmRecentTracksSchema = z.object({
  recenttracks: z.object({
    track: lastfmItems,
    '@attr': lastfmPageAttr,
  }),
});

export const lastfmArtistSchema = z.object({
  name: z.string().max(1024),
  playcount: countString,
  url: z.string().max(2048).optional(),
});

export const lastfmTopArtistsSchema = z.object({
  topartists: z.object({
    artist: lastfmItems,
  }),
});

/** Last.fm reports failures as `{ error, message }`, sometimes with HTTP 200. */
export const lastfmErrorSchema = z.object({
  error: z.number().int(),
  message: z.string().max(1024).optional(),
});

// Normalized output: what `/v1/listening` serves.

/** A Last.fm page for a track or artist. Links only; the site never loads from Last.fm. */
const lastfmUrlSchema = z
  .string()
  .max(2048)
  .regex(/^https:\/\/www\.last\.fm\/[^\s]*$/);

const trackSchema = z.object({
  track: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().min(1).nullable(),
  url: lastfmUrlSchema.nullable(),
});

export const listeningSnapshotSchema = z.object({
  /** The track playing when the snapshot was taken, or null when nothing was. */
  nowPlaying: trackSchema.nullable(),
  /** Up to 10 finished scrobbles, newest first. The now-playing track is not repeated here. */
  recent: z.array(trackSchema.extend({ playedAt: timestampSchema })).max(10),
  /** All-time top artists, up to 10; null when Last.fm did not answer this part. */
  topArtists: z
    .array(
      z.object({
        artist: z.string().min(1),
        plays: z.number().int().nonnegative(),
        url: lastfmUrlSchema.nullable(),
      })
    )
    .max(10)
    .nullable(),
  /**
   * Scrobbles in the current and the previous week; weeks start Monday 00:00 UTC. Each is
   * null when Last.fm did not answer that part.
   */
  scrobbles: z.object({
    thisWeek: z.number().int().nonnegative().nullable(),
    lastWeek: z.number().int().nonnegative().nullable(),
  }),
});

export type ListeningSnapshot = z.infer<typeof listeningSnapshotSchema>;

/** The `/v1/listening` response. */
export const listeningEnvelopeSchema = envelopeSchema(
  z.literal('listening'),
  listeningSnapshotSchema
);
