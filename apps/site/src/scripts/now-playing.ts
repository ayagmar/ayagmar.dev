// The home page's now-playing line, kept current in the browser (ADR 0015): the record turns
// only while Last.fm says a track is playing, in an answer that still describes now (ADR 0027).
import { readListening, renderNowPlaying } from '../lib/listening.ts';
import { live } from '../lib/live.ts';

live('listening', 60_000, readListening, (panel, answer, now) =>
  renderNowPlaying(panel.querySelector('.now-playing') as HTMLElement, answer, now)
);
