# 0022. Licensing: code MIT, writing all rights reserved

Status: accepted, 2026-10-26. Amended 2026-10-26: weather data from Open-Meteo is CC BY 4.0 (ADR 0029).

## Context

The repository is public. Code is meant to be reused; the writing is personal.

## Decision

Code is MIT (`LICENSE`). Everything under `content/` is all rights reserved, stated in `content/LICENSE`, with short attributed quotations allowed. The site footer links the colophon, which states both.

Weather data is neither. It comes from Open-Meteo under CC BY 4.0 (ADR 0029): what signals serves on `/v1/weather`, the weather fixtures in `packages/contracts/fixtures/open-meteo/` and `fixtures/weather/`, and the weather the home page draws. The MIT licence does not cover it. The home page credits it under the room, with links to Open-Meteo and the licence and a note that the picture is simplified, and the colophon says the same.

## Consequences

The owner may later relicense the writing (for example CC BY-NC); that is an open decision, not a change to the code license.
