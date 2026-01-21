import { Button, ButtonGroup, Dropdown } from 'react-bootstrap';
import {
  ArrowCounterclockwise,
  ArrowClockwise,
  TypeBold,
  TypeItalic,
  TypeUnderline,
  Link45deg,
  TextParagraph,
  TypeH1,
  TypeH2,
  TypeH3,
} from 'react-bootstrap-icons';
import { useTranslation } from 'react-i18next';

// Import necessary plugins
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
} from '@mdxeditor/editor';

// Update the editorStyles object
const editorStyles = {
  '[data-lexical-editor]': {
    outline: 'none',
    minHeight: '500px',
  },
  '.mdxeditor': {
    outline: 'none',
    border: 'none',
  },
  '.prose': {
    outline: 'none',
    border: 'none',
  },
  '.prose:focus': {
    outline: 'none',
    border: 'none',
  },
  '[contenteditable]': {
    outline: 'none',
    border: 'none',
  },
  '[contenteditable]:focus': {
    outline: 'none',
    border: 'none',
  },
};

const CustomToolbar = () => {
  const { t } = useTranslation('apps');

  return (
    <div className="border-bottom p-2 d-flex gap-2">
      <ButtonGroup size="sm">
        <Button variant="secondary" title={t('policyEditor.toolbar.undo')}>
          <ArrowCounterclockwise />
        </Button>
        <Button variant="secondary" title={t('policyEditor.toolbar.redo')}>
          <ArrowClockwise />
        </Button>
      </ButtonGroup>

      <ButtonGroup size="sm">
        <Button variant="secondary" title={t('policyEditor.toolbar.bold')}>
          <TypeBold />
        </Button>
        <Button variant="secondary" title={t('policyEditor.toolbar.italic')}>
          <TypeItalic />
        </Button>
        <Button variant="secondary" title={t('policyEditor.toolbar.underline')}>
          <TypeUnderline />
        </Button>
      </ButtonGroup>

      <Dropdown as={ButtonGroup} size="sm">
        <Dropdown.Toggle variant="secondary" id="block-type">
          <TextParagraph className="me-1" />
          {t('policyEditor.toolbar.blockType')}
        </Dropdown.Toggle>
        <Dropdown.Menu>
          <Dropdown.Item>
            <TypeH1 className="me-2" /> {t('policyEditor.toolbar.heading1')}
          </Dropdown.Item>
          <Dropdown.Item>
            <TypeH2 className="me-2" /> {t('policyEditor.toolbar.heading2')}
          </Dropdown.Item>
          <Dropdown.Item>
            <TypeH3 className="me-2" /> {t('policyEditor.toolbar.heading3')}
          </Dropdown.Item>
          <Dropdown.Item>
            <TextParagraph className="me-2" /> {t('policyEditor.toolbar.paragraph')}
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>

      <Button variant="secondary" size="sm" title={t('policyEditor.toolbar.insertLink')}>
        <Link45deg />
      </Button>
    </div>
  );
};

const PolicyEditor = ({
  showEditModal,
  setShowEditModal,
  selectedPolicy,
  initialValue,
  onChange,
  isLoading,
  chatMessages,
  onSendMessage,
  newMessage,
  onNewMessageChange,
}) => {
  const { t } = useTranslation('apps');

  return (
    <div
      className="policy-editor position-fixed top-0 h-100 bg-white"
      style={{
        zIndex: 1050,
        right: '0', // Position from right instead of left
        width: 'calc(100% - 60px)', // Full width minus sidebar
        transition: 'transform 0.3s ease-in-out',
        transform: showEditModal ? 'translateX(0)' : 'translateX(100%)',
      }}
    >
      <div className="policy-editor-header border-bottom d-flex justify-content-between align-items-center p-3">
        <h5 className="mb-0">
          {selectedPolicy?.name}
          {isLoading && <span className="ms-2 text-muted">({t('policyEditor.loading')})</span>}
        </h5>
        <Button variant="link" className="p-0 text-dark" onClick={() => setShowEditModal(false)}>
          ×
        </Button>
      </div>
      <div className="policy-editor-body d-flex h-100">
        <div className="w-50 h-100 border-end">
          <div className="editor-container" style={{ height: 'calc(100vh - 60px)', overflowY: 'auto' }}>
            <CustomToolbar />
            <div className="p-4">
              <MDXEditor
                markdown={initialValue || t('policyEditor.editorPlaceholder')}
                onChange={onChange}
                plugins={[
                  headingsPlugin(),
                  listsPlugin(),
                  quotePlugin(),
                  thematicBreakPlugin(),
                  markdownShortcutPlugin(),
                ]}
                style={editorStyles}
              />
            </div>
          </div>
        </div>

        <div className="w-50 h-100 d-flex flex-column">
          <div className="flex-grow-1 p-4" style={{ overflowY: 'auto' }}>
            {chatMessages.map((message, index) => (
              <div key={index} className={`mb-3 ${message.role === 'user' ? 'text-end' : ''}`}>
                <div
                  className={`d-inline-block p-3 rounded ${
                    message.role === 'user' ? 'bg-primary text-white' : 'bg-light'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-top">
            <form onSubmit={onSendMessage}>
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  value={newMessage}
                  onChange={(e) => onNewMessageChange(e.target.value)}
                  placeholder={t('policyEditor.chatPlaceholder')}
                />
                <Button type="submit" variant="primary">
                  {t('policyEditor.send')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PolicyEditor;
