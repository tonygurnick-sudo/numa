/**
 * Translate DB-shape responses into API-shape on the way out.
 *
 * The persistence layer still uses `teamId` / `team` / `teams` because the
 * underlying DynamoDB items have always been keyed that way (and we don't
 * want a data migration). The model, the frontend, and our public API all
 * want to talk in terms of `board` / `boardId` / `boards`. This is the
 * single boundary that translates.
 *
 * `dbToApi` walks objects and arrays recursively, renaming any matched
 * keys. Anything not in the rename map is left untouched. `jsonResponse`
 * wraps every payload through this helper so route handlers don't need
 * to remember.
 */

const DB_TO_API_KEYS: Record<string, string> = {
  teamId: 'boardId',
  team_id: 'board_id',
  team: 'board',
  teams: 'boards',
  teamIds: 'boardIds',
  team_ids: 'board_ids',
  currentTeamId: 'currentBoardId',
  current_team_id: 'current_board_id',
  linkedTeamId: 'linkedBoardId',
  linked_team_id: 'linked_board_id',
  // Internal field on Team meta items -- the DB stores this on the item but
  // the API surface should call it boardName.
  teamName: 'boardName',
};

const TEAM_WORD_REGEX = /\bteam(s)?\b/gi;

const renameTeamWord = (input: string): string =>
  input.replace(TEAM_WORD_REGEX, (match, plural) => {
    // Preserve case: "Team" -> "Board", "team" -> "board", "TEAM" -> "BOARD".
    const base = plural ? 'boards' : 'board';
    if (match[0] === match[0].toUpperCase()) {
      // Either Title-case ("Team") or all-caps ("TEAM").
      if (match === match.toUpperCase()) return base.toUpperCase();
      return base.charAt(0).toUpperCase() + base.slice(1);
    }
    return base;
  });

export const dbToApi = <T>(value: T): T => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => dbToApi(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    // Non-plain objects (Date, Buffer, typed arrays, Map, Set, custom class
    // instances) have `typeof === 'object'` but no enumerable own keys we
    // want to walk. Object.entries on a Date returns [], which would
    // silently coerce a Date payload to `{}`. Pass them through untouched
    // -- JSON.stringify handles Date natively (.toJSON), and the others
    // shouldn't appear in DDB payloads but are harmless if they do.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const newKey = DB_TO_API_KEYS[key] ?? key;
      out[newKey] = dbToApi(val);
    }
    return out as T;
  }
  return value;
};

export const API_TO_DB_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(DB_TO_API_KEYS).map(([db, api]) => [api, db])
);

/**
 * Inverse of `dbToApi`: walks an API-shape object/array and renames matched
 * keys back to their DB-shape equivalents (e.g. `boardId` -> `teamId`).
 *
 * Use this when an incoming request body needs to be compared against or
 * merged into a DB item -- without normalization, alias keys like `boardId`
 * look like brand-new fields versus the DB's `teamId`, producing phantom
 * diffs and duplicate columns in the stored item.
 */
export const apiToDb = <T>(value: T): T => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => apiToDb(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const newKey = API_TO_DB_KEYS[key] ?? key;
      out[newKey] = apiToDb(val);
    }
    return out as T;
  }
  return value;
};

/**
 * Translate "team" / "Team" / "teams" / "Teams" inside a single string,
 * preserving case. Used on error messages so callers see "Board not found"
 * rather than "Team not found".
 */
export const translateTeamString = (input: string): string => renameTeamWord(input);
