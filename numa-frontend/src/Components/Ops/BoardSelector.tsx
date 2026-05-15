import { Dropdown } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

type BoardSummaryItem = {
  id: string;
  name: string;
  color?: string;
  order?: number;
};

type BoardSelectorProps = {
  currentBoard: BoardSummaryItem | null;
  boards: BoardSummaryItem[];
  isAllBoards: boolean;
  pinnedBoardIds: string[] | null;
  onSelectBoard: (boardId: string) => void;
  onSelectAllBoards: () => void;
  onCreateBoard: () => void;
  onToggleBoardPin: (boardId: string) => void;
};

const BoardSelector = ({
  currentBoard,
  boards,
  isAllBoards,
  pinnedBoardIds,
  onSelectBoard,
  onSelectAllBoards,
  onCreateBoard,
  onToggleBoardPin,
}: BoardSelectorProps) => {
  const { t } = useTranslation('ops');

  return (
    <Dropdown className="ops-board-selector">
      <Dropdown.Toggle variant="outline-secondary" id="board-selector-dropdown">
        {isAllBoards ? (
          <span className="d-flex align-items-center gap-1">
            <i className="bi bi-grid me-1" style={{ fontSize: '0.75rem' }} />
            {t('boards.allBoardsLabel')}
          </span>
        ) : currentBoard ? (
          <span className="d-flex align-items-center gap-1">
            <span
              className="d-inline-block rounded-circle"
              style={{ width: 8, height: 8, backgroundColor: currentBoard.color ?? '#6c757d' }}
            />
            {currentBoard.name}
          </span>
        ) : (
          t('boards.selector')
        )}
      </Dropdown.Toggle>

      <Dropdown.Menu style={{ maxHeight: 400, overflowY: 'auto' }}>
        {/* All Boards option */}
        <Dropdown.Item active={isAllBoards} onClick={onSelectAllBoards}>
          <span className="d-flex align-items-center gap-2">
            <i className="bi bi-grid" style={{ fontSize: '0.85rem' }} />
            {t('boards.allBoardsLabel')}
          </span>
        </Dropdown.Item>

        {boards.length > 0 && <Dropdown.Divider />}

        {boards.map((board) => {
          const isPinned = pinnedBoardIds === null || pinnedBoardIds.includes(board.id);
          return (
            <Dropdown.Item
              as="div"
              key={board.id}
              active={!isAllBoards && board.id === currentBoard?.id}
              className="d-flex align-items-center gap-2"
              style={{ cursor: 'pointer', paddingTop: 6, paddingBottom: 6 }}
              onClick={() => onSelectBoard(board.id)}
            >
              <input
                type="checkbox"
                className="form-check-input flex-shrink-0 mt-0"
                checked={isPinned}
                onChange={() => {}}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleBoardPin(board.id);
                }}
                title={t('boards.showInStrip')}
                style={{ cursor: 'pointer' }}
              />
              <span
                className="d-inline-block rounded-circle flex-shrink-0"
                style={{ width: 8, height: 8, backgroundColor: board.color ?? '#6c757d' }}
              />
              <span className="flex-grow-1">{board.name}</span>
            </Dropdown.Item>
          );
        })}

        {boards.length > 0 && <Dropdown.Divider />}
        <Dropdown.Item onClick={onCreateBoard}>
          <i className="bi bi-plus me-1" />
          {t('boards.newBoard')}
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default BoardSelector;
