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
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const newKey = DB_TO_API_KEYS[key] ?? key;
      out[newKey] = dbToApi(val);
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
