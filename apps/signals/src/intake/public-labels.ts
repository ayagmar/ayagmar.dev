// The only identifiers signals publishes from a push, each with the label shown on the site.
// A producer-supplied id that is not listed here is dropped, whatever it is: an id can be
// sensitive by itself (a habit named after a medication, an agent key that is a file path).
// Adding an entry is a reviewed change to this file. Lookups go through Map, so ids such as
// `constructor` or `__proto__` cannot reach Object.prototype.

/** llm-usage-metrics source ids of coding agents. */
export const agentLabels: ReadonlyMap<string, string> = new Map([
  ['amp', 'Amp'],
  ['claude', 'Claude Code'],
  ['cline', 'Cline'],
  ['codex', 'Codex'],
  ['copilot', 'GitHub Copilot CLI'],
  ['droid', 'Droid'],
  ['gemini', 'Gemini CLI'],
  ['goose', 'Goose'],
  ['kilocode', 'Kilo Code'],
  ['kimi', 'Kimi CLI'],
  ['opencode', 'OpenCode'],
  ['pi', 'pi'],
  ['qwen', 'Qwen Code'],
  ['roocode', 'Roo Code'],
]);

/** trellis habit ids the owner has chosen to make public. */
export const habitLabels: ReadonlyMap<string, string> = new Map([
  ['meditation', 'Meditation'],
  ['reading', 'Reading'],
  ['writing', 'Writing'],
]);
