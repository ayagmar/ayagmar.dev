// The shared fixture set (fixtures/README.md), importable from every runtime: Node, workerd
// and the site build. Imported statically because workerd has no file system.
import githubRawEmpty from '../fixtures/github/raw/empty.json' with { type: 'json' };
import githubRawMalformed from '../fixtures/github/raw/malformed.json' with { type: 'json' };
import githubRawMissing from '../fixtures/github/raw/missing.json' with { type: 'json' };
import githubRawOk from '../fixtures/github/raw/ok.json' with { type: 'json' };
import githubRawPartial from '../fixtures/github/raw/partial.json' with { type: 'json' };
import lastfmRawEmpty from '../fixtures/lastfm/raw/empty.json' with { type: 'json' };
import lastfmRawErrorIn200 from '../fixtures/lastfm/raw/error-in-200.json' with { type: 'json' };
import lastfmRawMalformed from '../fixtures/lastfm/raw/malformed.json' with { type: 'json' };
import lastfmRawMissing from '../fixtures/lastfm/raw/missing.json' with { type: 'json' };
import lastfmRawOk from '../fixtures/lastfm/raw/ok.json' with { type: 'json' };
import lastfmRawPartial from '../fixtures/lastfm/raw/partial.json' with { type: 'json' };
import lastfmRawSingleItem from '../fixtures/lastfm/raw/single-item.json' with { type: 'json' };
import listeningSnapshotEmpty from '../fixtures/listening/snapshot/empty.json' with {
  type: 'json',
};
import listeningSnapshotOk from '../fixtures/listening/snapshot/ok.json' with { type: 'json' };
import listeningSnapshotPartial from '../fixtures/listening/snapshot/partial.json' with {
  type: 'json',
};
import listeningSnapshotSingleItem from '../fixtures/listening/snapshot/single-item.json' with {
  type: 'json',
};
import llmUsagePushMinimal from '../fixtures/llm-usage/push/accept/minimal.json' with {
  type: 'json',
};
import llmUsagePushOk from '../fixtures/llm-usage/push/accept/ok.json' with { type: 'json' };
import llmUsagePushSensitiveFields from '../fixtures/llm-usage/push/accept/sensitive-fields.json' with {
  type: 'json',
};
import llmUsageSnapshotMinimal from '../fixtures/llm-usage/snapshot/minimal.json' with {
  type: 'json',
};
import llmUsageSnapshotOk from '../fixtures/llm-usage/snapshot/ok.json' with { type: 'json' };
import llmUsageSnapshotSensitiveFields from '../fixtures/llm-usage/snapshot/sensitive-fields.json' with {
  type: 'json',
};
import npmRawEmpty from '../fixtures/npm/raw/empty.json' with { type: 'json' };
import npmRawMalformed from '../fixtures/npm/raw/malformed.json' with { type: 'json' };
import npmRawMissing from '../fixtures/npm/raw/missing.json' with { type: 'json' };
import npmRawOk from '../fixtures/npm/raw/ok.json' with { type: 'json' };
import npmRawPartial from '../fixtures/npm/raw/partial.json' with { type: 'json' };
import openMeteoRawClear from '../fixtures/open-meteo/raw/clear.json' with { type: 'json' };
import openMeteoRawEmpty from '../fixtures/open-meteo/raw/empty.json' with { type: 'json' };
import openMeteoRawFog from '../fixtures/open-meteo/raw/fog.json' with { type: 'json' };
import openMeteoRawMalformed from '../fixtures/open-meteo/raw/malformed.json' with { type: 'json' };
import openMeteoRawMissing from '../fixtures/open-meteo/raw/missing.json' with { type: 'json' };
import openMeteoRawOk from '../fixtures/open-meteo/raw/ok.json' with { type: 'json' };
import openMeteoRawPartial from '../fixtures/open-meteo/raw/partial.json' with { type: 'json' };
import openMeteoRawRain from '../fixtures/open-meteo/raw/rain.json' with { type: 'json' };
import openMeteoRawSnow from '../fixtures/open-meteo/raw/snow.json' with { type: 'json' };
import openMeteoRawStorm from '../fixtures/open-meteo/raw/storm.json' with { type: 'json' };
import openMeteoRawUnknownCode from '../fixtures/open-meteo/raw/unknown-code.json' with {
  type: 'json',
};
import projectsSnapshotEmpty from '../fixtures/projects/snapshot/empty.json' with { type: 'json' };
import projectsSnapshotOk from '../fixtures/projects/snapshot/ok.json' with { type: 'json' };
import projectsSnapshotPartial from '../fixtures/projects/snapshot/partial.json' with {
  type: 'json',
};
import repoPulseRawEmpty from '../fixtures/repo-pulse/raw/empty.json' with { type: 'json' };
import repoPulseRawMalformed from '../fixtures/repo-pulse/raw/malformed.json' with { type: 'json' };
import repoPulseRawMissing from '../fixtures/repo-pulse/raw/missing.json' with { type: 'json' };
import repoPulseRawOk from '../fixtures/repo-pulse/raw/ok.json' with { type: 'json' };
import repoPulseRawPartial from '../fixtures/repo-pulse/raw/partial.json' with { type: 'json' };
import shelfSnapshotMinimal from '../fixtures/shelf/snapshot/minimal.json' with { type: 'json' };
import shelfSnapshotOk from '../fixtures/shelf/snapshot/ok.json' with { type: 'json' };
import shelfSnapshotSensitiveFields from '../fixtures/shelf/snapshot/sensitive-fields.json' with {
  type: 'json',
};
import shippingSnapshotEmpty from '../fixtures/shipping/snapshot/empty.json' with { type: 'json' };
import shippingSnapshotOk from '../fixtures/shipping/snapshot/ok.json' with { type: 'json' };
import shippingSnapshotPartial from '../fixtures/shipping/snapshot/partial.json' with {
  type: 'json',
};
import trellisPushMinimal from '../fixtures/trellis/push/accept/minimal.json' with { type: 'json' };
import trellisPushOk from '../fixtures/trellis/push/accept/ok.json' with { type: 'json' };
import trellisPushSensitiveFields from '../fixtures/trellis/push/accept/sensitive-fields.json' with {
  type: 'json',
};

import weatherSnapshotClear from '../fixtures/weather/snapshot/clear.json' with { type: 'json' };
import weatherSnapshotFog from '../fixtures/weather/snapshot/fog.json' with { type: 'json' };
import weatherSnapshotOk from '../fixtures/weather/snapshot/ok.json' with { type: 'json' };
import weatherSnapshotPartial from '../fixtures/weather/snapshot/partial.json' with {
  type: 'json',
};
import weatherSnapshotRain from '../fixtures/weather/snapshot/rain.json' with { type: 'json' };
import weatherSnapshotSnow from '../fixtures/weather/snapshot/snow.json' with { type: 'json' };
import weatherSnapshotStorm from '../fixtures/weather/snapshot/storm.json' with { type: 'json' };
import weatherSnapshotUnknownCode from '../fixtures/weather/snapshot/unknown-code.json' with {
  type: 'json',
};

/** When the real fixture data was captured; the time the site's fixtures mode shows. */
export const fixturesCapturedAt = '2026-10-26T09:00:00Z';

/** Upstream responses as each adapter's `fetch` returns them. */
export const rawFixtures = {
  github: {
    empty: githubRawEmpty,
    malformed: githubRawMalformed,
    missing: githubRawMissing,
    ok: githubRawOk,
    partial: githubRawPartial,
  },
  lastfm: {
    empty: lastfmRawEmpty,
    'error-in-200': lastfmRawErrorIn200,
    malformed: lastfmRawMalformed,
    missing: lastfmRawMissing,
    ok: lastfmRawOk,
    partial: lastfmRawPartial,
    'single-item': lastfmRawSingleItem,
  },
  npm: {
    empty: npmRawEmpty,
    malformed: npmRawMalformed,
    missing: npmRawMissing,
    ok: npmRawOk,
    partial: npmRawPartial,
  },
  'open-meteo': {
    clear: openMeteoRawClear,
    empty: openMeteoRawEmpty,
    fog: openMeteoRawFog,
    malformed: openMeteoRawMalformed,
    missing: openMeteoRawMissing,
    ok: openMeteoRawOk,
    partial: openMeteoRawPartial,
    rain: openMeteoRawRain,
    snow: openMeteoRawSnow,
    storm: openMeteoRawStorm,
    'unknown-code': openMeteoRawUnknownCode,
  },
  'repo-pulse': {
    empty: repoPulseRawEmpty,
    malformed: repoPulseRawMalformed,
    missing: repoPulseRawMissing,
    ok: repoPulseRawOk,
    partial: repoPulseRawPartial,
  },
} as const;

/** Normalized snapshots, as `/v1/<source>` serves them in `data`. */
export const snapshotFixtures = {
  listening: {
    empty: listeningSnapshotEmpty,
    ok: listeningSnapshotOk,
    partial: listeningSnapshotPartial,
    'single-item': listeningSnapshotSingleItem,
  },
  'llm-usage': {
    minimal: llmUsageSnapshotMinimal,
    ok: llmUsageSnapshotOk,
    'sensitive-fields': llmUsageSnapshotSensitiveFields,
  },
  projects: {
    empty: projectsSnapshotEmpty,
    ok: projectsSnapshotOk,
    partial: projectsSnapshotPartial,
  },
  shelf: {
    minimal: shelfSnapshotMinimal,
    ok: shelfSnapshotOk,
    'sensitive-fields': shelfSnapshotSensitiveFields,
  },
  shipping: {
    empty: shippingSnapshotEmpty,
    ok: shippingSnapshotOk,
    partial: shippingSnapshotPartial,
  },
  weather: {
    clear: weatherSnapshotClear,
    fog: weatherSnapshotFog,
    ok: weatherSnapshotOk,
    partial: weatherSnapshotPartial,
    rain: weatherSnapshotRain,
    snow: weatherSnapshotSnow,
    storm: weatherSnapshotStorm,
    'unknown-code': weatherSnapshotUnknownCode,
  },
} as const;

/** Push bodies every validator accepts; the Worker's intake tests send them. */
export const pushFixtures = {
  'llm-usage': {
    minimal: llmUsagePushMinimal,
    ok: llmUsagePushOk,
    'sensitive-fields': llmUsagePushSensitiveFields,
  },
  trellis: {
    minimal: trellisPushMinimal,
    ok: trellisPushOk,
    'sensitive-fields': trellisPushSensitiveFields,
  },
} as const;
