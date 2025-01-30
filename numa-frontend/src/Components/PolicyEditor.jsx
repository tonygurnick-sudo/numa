import React, { useEffect, useState } from 'react';
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
  Border,
} from 'react-bootstrap-icons';

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

const CustomToolbar = () => (
  <div className="border-bottom p-2 d-flex gap-2">
    <ButtonGroup size="sm">
      <Button variant="outline-secondary" title="Undo">
        <ArrowCounterclockwise />
      </Button>
      <Button variant="outline-secondary" title="Redo">
        <ArrowClockwise />
      </Button>
    </ButtonGroup>

    <ButtonGroup size="sm">
      <Button variant="outline-secondary" title="Bold">
        <TypeBold />
      </Button>
      <Button variant="outline-secondary" title="Italic">
        <TypeItalic />
      </Button>
      <Button variant="outline-secondary" title="Underline">
        <TypeUnderline />
      </Button>
    </ButtonGroup>

    <Dropdown as={ButtonGroup} size="sm">
      <Dropdown.Toggle variant="outline-secondary" id="block-type">
        <TextParagraph className="me-1" />
        Block Type
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item>
          <TypeH1 className="me-2" /> Heading 1
        </Dropdown.Item>
        <Dropdown.Item>
          <TypeH2 className="me-2" /> Heading 2
        </Dropdown.Item>
        <Dropdown.Item>
          <TypeH3 className="me-2" /> Heading 3
        </Dropdown.Item>
        <Dropdown.Item>
          <TextParagraph className="me-2" /> Paragraph
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>

    <Button variant="outline-secondary" size="sm" title="Insert Link">
      <Link45deg />
    </Button>
  </div>
);

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
          {isLoading && <span className="ms-2 text-muted">(Loading...)</span>}
        </h5>
        <Button
          variant="link"
          className="p-0 text-dark"
          onClick={() => setShowEditModal(false)}
        >
          ×
        </Button>
      </div>
      <div className="policy-editor-body d-flex h-100">
        <div className="w-50 h-100 border-end">
          <div
            className="editor-container"
            style={{ height: 'calc(100vh - 60px)', overflowY: 'auto' }}
          >
            <CustomToolbar />
            <div className="p-4">
              <MDXEditor
                markdown={initialValue || '# Start editing your policy here...'}
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
              <div
                key={index}
                className={`mb-3 ${message.role === 'user' ? 'text-end' : ''}`}
              >
                <div
                  className={`d-inline-block p-3 rounded ${
                    message.role === 'user'
                      ? 'bg-primary text-white'
                      : 'bg-light'
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
                  placeholder="Type your message..."
                />
                <Button type="submit" variant="primary">
                  Send
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
