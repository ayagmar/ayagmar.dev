import { Hono } from 'hono';
import type { AppEnv } from '../../env.ts';
import { methodNotAllowed } from '../../errors.ts';
import { desktopProducer } from '../../intake/desktop.ts';
import { handlePush } from '../../intake/handle.ts';
import { llmUsageProducer } from '../../intake/llm-usage.ts';
import { trellisProducer } from '../../intake/trellis.ts';

/** `POST /v1/push/<producer>`. No CORS: producers are not browsers. */
export const push = new Hono<AppEnv>()
  .post('/llm-usage', (c) => handlePush(llmUsageProducer, c))
  .post('/trellis', (c) => handlePush(trellisProducer, c))
  .post('/desktop', (c) => handlePush(desktopProducer, c))
  .all('/:producer{llm-usage|trellis|desktop}', methodNotAllowed('POST'));
