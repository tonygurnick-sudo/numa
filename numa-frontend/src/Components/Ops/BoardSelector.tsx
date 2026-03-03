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
  onSelectBoard: (boardId: string) => void;
  onSelectAllBoards: () => void;
  onCreateBoard: () => void;
};

const BoardSelector = ({
  currentBoard,
  boards,
  isAllBoards,
  onSelectBoard,
  onSelectAllBoards,
  onCreateBoard,
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

        {boards.map((board) => (
          <Dropdown.Item
            key={board.id}
            active={!isAllBoards && board.id === currentBoard?.id}
            onClick={() => onSelectBoard(board.id)}
          >
            <span className="d-flex align-items-center gap-2">
              <span
                className="d-inline-block rounded-circle"
                style={{ width: 8, height: 8, backgroundColor: board.color ?? '#6c757d' }}
              />
              {board.name}
            </span>
          </Dropdown.Item>
        ))}

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
