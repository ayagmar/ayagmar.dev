// The shared fixture set (fixtures/README.md), importable from every runtime: Node, workerd
// and the site build. Imported statically because workerd has no file system.
import desktopPushMinimal from '../fixtures/desktop/push/accept/minimal.json' with { type: 'json' };
import desktopPushOk from '../fixtures/desktop/push/accept/ok.json' with { type: 'json' };
import desktopPushSensitiveFields from '../fixtures/desktop/push/accept/sensitive-fields.json' with {
  type: 'json',
};
import desktopSnapshotMinimal from '../fixtures/desktop/snapshot/minimal.json' with {
  type: 'json',
};
import desktopSnapshotOk from '../fixtures/desktop/snapshot/ok.json' with { type: 'json' };
import desktopSnapshotSensitiveFields from '../fixtures/desktop/snapshot/sensitive-fields.json' with {
  type: 'json',
};
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
import lastfmHistoryRawApproximate from '../fixtures/lastfm-history/raw/approximate.json' with {
  type: 'json',
};
import lastfmHistoryRawEmpty from '../fixtures/lastfm-history/raw/empty.json' with { type: 'json' };
import lastfmHistoryRawErrorIn200 from '../fixtures/lastfm-history/raw/error-in-200.json' with {
  type: 'json',
};
import lastfmHistoryRawFeb28 from '../fixtures/lastfm-history/raw/feb-28.json' with {
  type: 'json',
};
import lastfmHistoryRawInconsistent from '../fixtures/lastfm-history/raw/inconsistent.json' with {
  type: 'json',
};
import lastfmHistoryRawLeapDay from '../fixtures/lastfm-history/raw/leap-day.json' with {
  type: 'json',
};
import lastfmHistoryRawMalformed from '../fixtures/lastfm-history/raw/malformed.json' with {
  type: 'json',
};
import lastfmHistoryRawMissing from '../fixtures/lastfm-history/raw/missing.json' with {
  type: 'json',
};
import lastfmHistoryRawNewAccount from '../fixtures/lastfm-history/raw/new-account.json' with {
  type: 'json',
};
import lastfmHistoryRawNowPlaying from '../fixtures/lastfm-history/raw/now-playing.json' with {
  type: 'json',
};
import lastfmHistoryRawOk from '../fixtures/lastfm-history/raw/ok.json' with { type: 'json' };
import lastfmHistoryRawSingleItem from '../fixtures/lastfm-history/raw/single-item.json' with {
  type: 'json',
};
import lastfmHistoryRawTies from '../fixtures/lastfm-history/raw/ties.json' with { type: 'json' };
import lastfmHistoryRawUnknownRegistration from '../fixtures/lastfm-history/raw/unknown-registration.json' with {
  type: 'json',
};
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
import listeningHistorySnapshotApproximate from '../fixtures/listening-history/snapshot/approximate.json' with {
  type: 'json',
};
import listeningHistorySnapshotEmpty from '../fixtures/listening-history/snapshot/empty.json' with {
  type: 'json',
};
import listeningHistorySnapshotFeb28 from '../fixtures/listening-history/snapshot/feb-28.json' with {
  type: 'json',
};
import listeningHistorySnapshotLeapDay from '../fixtures/listening-history/snapshot/leap-day.json' with {
  type: 'json',
};
import listeningHistorySnapshotNewAccount from '../fixtures/listening-history/snapshot/new-account.json' with {
  type: 'json',
};
import listeningHistorySnapshotNowPlaying from '../fixtures/listening-history/snapshot/now-playing.json' with {
  type: 'json',
};
import listeningHistorySnapshotOk from '../fixtures/listening-history/snapshot/ok.json' with {
  type: 'json',
};
import listeningHistorySnapshotSingleItem from '../fixtures/listening-history/snapshot/single-item.json' with {
  type: 'json',
};
import listeningHistorySnapshotTies from '../fixtures/listening-history/snapshot/ties.json' with {
  type: 'json',
};
import llmUsageDaysOk from '../fixtures/llm-usage/days/ok.json' with { type: 'json' };
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
import monkeytypeRawEmpty from '../fixtures/monkeytype/raw/empty.json' with { type: 'json' };
import monkeytypeRawMalformed from '../fixtures/monkeytype/raw/malformed.json' with {
  type: 'json',
};
import monkeytypeRawMissing from '../fixtures/monkeytype/raw/missing.json' with { type: 'json' };
import monkeytypeRawOk from '../fixtures/monkeytype/raw/ok.json' with { type: 'json' };
import monkeytypeRawPartial from '../fixtures/monkeytype/raw/partial.json' with { type: 'json' };
import monkeytypeRawSensitiveFields from '../fixtures/monkeytype/raw/sensitive-fields.json' with {
  type: 'json',
};
import monkeytypeSnapshotEmpty from '../fixtures/monkeytype/snapshot/empty.json' with {
  type: 'json',
};
import monkeytypeSnapshotOk from '../fixtures/monkeytype/snapshot/ok.json' with { type: 'json' };
import monkeytypeSnapshotPartial from '../fixtures/monkeytype/snapshot/partial.json' with {
  type: 'json',
};
import monkeytypeSnapshotSensitiveFields from '../fixtures/monkeytype/snapshot/sensitive-fields.json' with {
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
import repoPulseActivityRawIncomplete from '../fixtures/repo-pulse-activity/raw/incomplete.json' with {
  type: 'json',
};
import repoPulseActivityRawMalformed from '../fixtures/repo-pulse-activity/raw/malformed.json' with {
  type: 'json',
};
import repoPulseActivityRawMissing from '../fixtures/repo-pulse-activity/raw/missing.json' with {
  type: 'json',
};
import repoPulseActivityRawOk from '../fixtures/repo-pulse-activity/raw/ok.json' with {
  type: 'json',
};
import repoPulseActivityRawSinceNull from '../fixtures/repo-pulse-activity/raw/since-null.json' with {
  type: 'json',
};
import repoPulseActivityRawUnavailable from '../fixtures/repo-pulse-activity/raw/unavailable.json' with {
  type: 'json',
};
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
import shippingActivityDaysOk from '../fixtures/shipping-activity/days/ok.json' with {
  type: 'json',
};
import shippingActivitySnapshotOk from '../fixtures/shipping-activity/snapshot/ok.json' with {
  type: 'json',
};
import shippingActivitySnapshotSinceNull from '../fixtures/shipping-activity/snapshot/since-null.json' with {
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
  'lastfm-history': {
    approximate: lastfmHistoryRawApproximate,
    empty: lastfmHistoryRawEmpty,
    'error-in-200': lastfmHistoryRawErrorIn200,
    'feb-28': lastfmHistoryRawFeb28,
    inconsistent: lastfmHistoryRawInconsistent,
    'leap-day': lastfmHistoryRawLeapDay,
    malformed: lastfmHistoryRawMalformed,
    missing: lastfmHistoryRawMissing,
    'new-account': lastfmHistoryRawNewAccount,
    'now-playing': lastfmHistoryRawNowPlaying,
    ok: lastfmHistoryRawOk,
    'single-item': lastfmHistoryRawSingleItem,
    ties: lastfmHistoryRawTies,
    'unknown-registration': lastfmHistoryRawUnknownRegistration,
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
  monkeytype: {
    empty: monkeytypeRawEmpty,
    malformed: monkeytypeRawMalformed,
    missing: monkeytypeRawMissing,
    ok: monkeytypeRawOk,
    partial: monkeytypeRawPartial,
    'sensitive-fields': monkeytypeRawSensitiveFields,
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
  'repo-pulse-activity': {
    incomplete: repoPulseActivityRawIncomplete,
    malformed: repoPulseActivityRawMalformed,
    missing: repoPulseActivityRawMissing,
    ok: repoPulseActivityRawOk,
    'since-null': repoPulseActivityRawSinceNull,
    unavailable: repoPulseActivityRawUnavailable,
  },
} as const;

/** Normalized snapshots, as `/v1/<source>` serves them in `data`. */
export const snapshotFixtures = {
  desktop: {
    minimal: desktopSnapshotMinimal,
    ok: desktopSnapshotOk,
    'sensitive-fields': desktopSnapshotSensitiveFields,
  },
  'listening-history': {
    approximate: listeningHistorySnapshotApproximate,
    empty: listeningHistorySnapshotEmpty,
    'feb-28': listeningHistorySnapshotFeb28,
    'leap-day': listeningHistorySnapshotLeapDay,
    'new-account': listeningHistorySnapshotNewAccount,
    'now-playing': listeningHistorySnapshotNowPlaying,
    ok: listeningHistorySnapshotOk,
    'single-item': listeningHistorySnapshotSingleItem,
    ties: listeningHistorySnapshotTies,
  },
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
  monkeytype: {
    empty: monkeytypeSnapshotEmpty,
    ok: monkeytypeSnapshotOk,
    partial: monkeytypeSnapshotPartial,
    'sensitive-fields': monkeytypeSnapshotSensitiveFields,
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
  'shipping-activity': {
    ok: shippingActivitySnapshotOk,
    'since-null': shippingActivitySnapshotSinceNull,
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
  desktop: {
    minimal: desktopPushMinimal,
    ok: desktopPushOk,
    'sensitive-fields': desktopPushSensitiveFields,
  },
  trellis: {
    minimal: trellisPushMinimal,
    ok: trellisPushOk,
    'sensitive-fields': trellisPushSensitiveFields,
  },
} as const;

/** Daily history blocks, as `/v1/days/<series>?last=28` serves them in `data` (ADR 0038). */
export const daysFixtures = {
  'shipping-activity': {
    ok: shippingActivityDaysOk,
  },
  'llm-usage': {
    ok: llmUsageDaysOk,
  },
} as const;
