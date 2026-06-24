import React, { useRef, useEffect, useState } from 'react';
import { getFlag } from '../../utils/featureFlags';
import { Button, Form, Spinner, Modal, Dropdown, Badge, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { Search, Robot } from 'react-bootstrap-icons';
import { Paperclip, Send, ChevronDown } from 'lucide-react';
import VoiceRecordButton, { isVoiceRecordingSupported } from './VoiceRecordButton';
import type { VoiceRecordingState } from './VoiceRecordButton';
import { useTranslation } from 'react-i18next';
import { FeatureWrapper } from '../RequiredFeaturesWrapper';
import {
  getConnectionIcon,
  getConnectionFallbackIcon,
  getConnectionFallbackColor,
  getConnectionDisplayName,
} from '../../config/integrationsConfig';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import { useDrawerBackClose } from '../../hooks/useDrawerBackClose';
import type { WorkspaceChatModelId } from '../../types/workspaceChatTypes';
import { WORKSPACE_MODEL_OPTIONS, WORKSPACE_MODEL_OPTIONS_CURATED } from '../../types/workspaceChatTypes';
import { IntegrationAccountButton } from '../Integrations/IntegrationAccountSelector';

// WebSocket message size limit (AWS API Gateway limit is 32KB)
const MAX_MESSAGE_LENGTH = 20000; // Conservative limit accounting for JSON overhead

/** ChatInput variant - 'v1' is the default with all dropdowns, 'v2' is simplified for workspace chat */
export type ChatInputVariant = 'v1' | 'v2';

const ChatInput = ({
  inputMessage,
  setInputMessage,
  handleSubmit,
  setShowUploadModal,
  buttonStatus,
  webSearchEnabled,
  setWebSearchEnabled,
  createAgentEnabled,
  setCreateAgentEnabled,
  autoToolsEnabled,
  setAutoToolsEnabled,
  availableConnections = [],
  enabledConnections = [],
  setEnabledConnections,
  // FEAT-019: optional per-conversation account scope. When the connection
  // allows multiple accounts AND the user has narrowed the selection, only
  // those accountIds are exposed to the agent for this chat.
  selectedAccountsByApp = {} as Record<string, string[]>,
  setSelectedAccountsByApp = undefined as
    | ((updater: (prev: Record<string, string[]>) => Record<string, string[]>) => void)
    | undefined,
  connectionsLoading = false,
  hasPipedreamFeature = false,
  disabled = false,
  externalInputRef = null,
  autoFocus = false,
  placeholderOverride = undefined,
  uploadsInProgress = false,
  noToolsActive: _noToolsActive = false,
  // Multi‑folder selection (controlled by parent)
  enabledKBIds = [],
  setEnabledKBIds,
  dropdownDirection = 'up',
  // Optional reason why upload is disabled (shown as tooltip)
  uploadDisabledReason = '',
  // Model selection (workspace chat only)
  selectedModelId = undefined as WorkspaceChatModelId | undefined,
  setSelectedModelId = undefined as ((id: WorkspaceChatModelId) => void) | undefined,
  showModelSelector = false,
  // Lock the model selector once the conversation has started (no mid-conversation
  // switching). Independent of streaming/controls-disabled. Used by the v2 composer.
  modelLocked = false,
  onStop = undefined as (() => void) | undefined,
  isStopping = false,
  // V2 variant props
  variant = 'v1' as ChatInputVariant,
  onSettingsClick = undefined as (() => void) | undefined,
  isSettingsPanelOpen = false,
  hasActiveSettings = false,
  onPasteFiles = undefined as ((files: File[]) => void) | undefined,
  // When the composer has staged attachments, show Send (not the voice mic) even
  // with empty text, so an attachment-only message can be sent with a click.
  hasStagedAttachments = false,
  // Voice recording
  onVoiceRecordingComplete = undefined as ((blob: Blob, filename: string) => void) | undefined,
  voiceRecordingState = 'idle' as VoiceRecordingState,
  voiceInputEnabled = false,
  // Chat-health indicators rendered after the upload button (v1 left-controls).
  // Passed in as a slot so this component stays presentation-only.
  chatHealthSlot = null as React.ReactNode,
}) => {
  const { t } = useTranslation('chat');
  const internalRef = useRef(null);
  const inputRef = externalInputRef || internalRef;
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
  const [showKBDropdown, setShowKBDropdown] = useState(false);
  const [showToolsDropdown, setShowToolsDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [manualV2Height, setManualV2Height] = useState<number | null>(null);
  const v2ResizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [isMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const {
    selectedKB: _selectedKB,
    availableKBs,
    isLoadingKBs,
    selectKBById: _selectKBById,
    refreshKBs,
  } = useKnowledgeBase();
  const agentsFeatureEnabled = getFlag('AGENTS');

  const maxVisibleConnectionIcons = isMobile ? 2 : 4;
  const visibleConnectionIds = enabledConnections.slice(0, maxVisibleConnectionIcons);
  const hiddenConnectionCount = Math.max(0, enabledConnections.length - visibleConnectionIds.length);
  // Enable mobile back button to close dropdowns
  useDrawerBackClose({
    isOpen: showKBDropdown,
    onClose: () => setShowKBDropdown(false),
    enabled: isMobile,
    stateKey: 'kb-dropdown',
  });

  useDrawerBackClose({
    isOpen: showToolsDropdown,
    onClose: () => setShowToolsDropdown(false),
    enabled: isMobile,
    stateKey: 'tools-dropdown',
  });

  useDrawerBackClose({
    isOpen: showModelDropdown,
    onClose: () => setShowModelDropdown(false),
    enabled: isMobile,
    stateKey: 'model-dropdown',
  });

  // Agent mode is the default and only mode; remove legacy flag checks

  // Keep text input enabled during chat processing and uploads; only honor a hard disable
  const isTextInputDisabled = !!disabled;

  // Send is disabled by loading/streaming/hard-disable/oversized — but NOT by
  // uploadsInProgress. The parent intercepts submits during uploads and queues them
  // (auto-firing once staging completes), so the user can hit Enter/Send any time.
  const isSendDisabled = buttonStatus === 'loading' || !!disabled || inputMessage.length > MAX_MESSAGE_LENGTH;

  const showStopButton = buttonStatus === 'streaming' && !!onStop;
  const showSendSpinner = (buttonStatus === 'loading' || buttonStatus === 'streaming') && !showStopButton;

  // Keep other controls disabled during streaming/uploads to avoid mid-turn config changes
  const isControlsDisabled = buttonStatus === 'streaming' || uploadsInProgress || !!disabled;

  // V2: show mic button in place of send when input is empty and voice is available
  const showVoiceMicAsSend =
    variant === 'v2' &&
    voiceInputEnabled &&
    isVoiceRecordingSupported() &&
    !!onVoiceRecordingComplete &&
    !inputMessage.trim() &&
    !hasStagedAttachments &&
    !showStopButton &&
    !showSendSpinner;

  // Placeholder: prefer explicit override, otherwise use variant-specific default
  const placeholderText = placeholderOverride ?? t(variant === 'v2' ? 'input.placeholderV2' : 'input.placeholder');
  const v2BaseHeight = isMobile ? 40 : 44;

  const getKnowledgeBaseLabel = (kb: { kb_id: string; kb_name: string }) => {
    if (kb.kb_id === 'company') {
      return t('input.kb.companyName', { defaultValue: kb.kb_name || kb.kb_id });
    }
    return kb.kb_name || kb.kb_id;
  };

  const getKnowledgeBaseRoleLabel = (role?: string) => {
    if (!role) return '';
    return t(`input.kb.roles.${role.toLowerCase()}`, { defaultValue: role });
  };

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    const baseHeight = variant === 'v2' ? v2BaseHeight : 46;

    // Don't update the input if it exceeds the limit
    if (newValue.length > MAX_MESSAGE_LENGTH) {
      return;
    }

    setInputMessage(newValue);

    if (variant === 'v2') {
      const textarea = e.target as HTMLTextAreaElement;
      const computedMaxHeight = Number.parseFloat(window.getComputedStyle(textarea).maxHeight);
      const effectiveMaxHeight = Number.isFinite(computedMaxHeight) ? computedMaxHeight : Number.POSITIVE_INFINITY;

      const desiredHeight =
        manualV2Height !== null ? Math.max(baseHeight, manualV2Height) : Math.max(baseHeight, textarea.scrollHeight);
      const nextHeight = Math.min(desiredHeight, effectiveMaxHeight);

      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > nextHeight + 1 ? 'auto' : 'hidden';
      return;
    }

    // V1 behavior
    e.target.style.height = `${baseHeight}px`;
    const shouldExpand = newValue.includes('\n') || e.target.scrollHeight > baseHeight + 8;
    if (shouldExpand) {
      e.target.style.height = `${e.target.scrollHeight}px`;
    }
  };

  const handleV2ResizeStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (variant !== 'v2' || !inputRef.current) return;

    const textarea = inputRef.current as HTMLTextAreaElement;
    const startHeight = textarea.offsetHeight || v2BaseHeight;
    v2ResizeStateRef.current = { startY: e.clientY, startHeight };
    textarea.style.overflowY = 'hidden';

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!v2ResizeStateRef.current || !inputRef.current) return;
      moveEvent.preventDefault();

      const currentTextarea = inputRef.current as HTMLTextAreaElement;
      const { startY, startHeight: dragStartHeight } = v2ResizeStateRef.current;
      const deltaY = startY - moveEvent.clientY;
      const desiredHeight = dragStartHeight + deltaY;

      const computedMaxHeight = Number.parseFloat(window.getComputedStyle(currentTextarea).maxHeight);
      const maxHeight = Number.isFinite(computedMaxHeight) ? computedMaxHeight : Number.POSITIVE_INFINITY;
      const clampedHeight = Math.min(Math.max(desiredHeight, v2BaseHeight), maxHeight);

      currentTextarea.style.height = `${clampedHeight}px`;
      currentTextarea.style.overflowY = currentTextarea.scrollHeight > clampedHeight + 1 ? 'auto' : 'hidden';
      setManualV2Height(clampedHeight > v2BaseHeight + 1 ? clampedHeight : null);
    };

    const onMouseUp = () => {
      v2ResizeStateRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Reset height when inputMessage is cleared.
  useEffect(() => {
    const baseHeight = variant === 'v2' ? v2BaseHeight : 46;
    if (inputMessage === '' && inputRef.current) {
      setManualV2Height(null);
      inputRef.current.style.height = `${baseHeight}px`;
      inputRef.current.style.overflowY = 'hidden';
    }
  }, [inputMessage, inputRef, v2BaseHeight, variant]);

  // Auto focus when requested and input is enabled
  useEffect(() => {
    if (autoFocus && inputRef.current && !isTextInputDisabled) {
      inputRef.current.focus();
    }
  }, [autoFocus, isTextInputDisabled]);

  const handleKeyDown = (e) => {
    // If send is disabled or message is too large, don't process Enter as a submit
    if (isSendDisabled || inputMessage.length > MAX_MESSAGE_LENGTH) {
      return;
    }

    // Press Enter to submit
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    if (!onPasteFiles || !e.clipboardData) return;

    const items = e.clipboardData.items;
    let hasFiles = false;

    // Check if there are any files synchronously
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        hasFiles = true;
        break;
      }
    }

    if (hasFiles) {
      // Only prevent default if there's no actual text included in the clipboard
      const plainText = e.clipboardData.getData('text/plain');
      if (!plainText) {
        e.preventDefault();
      }

      const filePromises: Promise<File | null>[] = [];

      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const originalFile = items[i].getAsFile();
          if (originalFile) {
            // Eagerly read the file into memory to detach it from the clipboard event
            // lifecycle. If we don't do this, Async uploads (like S3 Presigned URLs)
            // will fail as the browser revokes the clipboard blob memory!
            const promise = originalFile
              .arrayBuffer()
              .then((buffer) => {
                let uniqueName = originalFile.name;

                // Browsers typically assign a generic name like "image.png" to raw clipboard screenshots.
                // If we don't make this unique, pasting two images sequentially will overwrite in S3.
                if (/^(image|clipboard)\.(png|jpg|jpeg|gif|webp)$/i.test(originalFile.name)) {
                  const ext = originalFile.name.split('.').pop() || 'png';
                  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                  uniqueName = `pasted-image-${timestamp}.${ext}`;
                }

                return new File([buffer], uniqueName, { type: originalFile.type });
              })
              .catch((err) => {
                console.error('Failed to read pasted file from clipboard:', err);
                return null;
              });

            filePromises.push(promise);
          }
        }
      }

      if (filePromises.length > 0) {
        const resolvedFiles = (await Promise.all(filePromises)).filter((f): f is File => f !== null);
        if (resolvedFiles.length > 0) {
          onPasteFiles(resolvedFiles);
        }
      }
    }
  };

  // Custom submit handler to prevent submission of oversized messages
  const handleFormSubmit = (e) => {
    if (inputMessage.length > MAX_MESSAGE_LENGTH) {
      e.preventDefault();
      return;
    }
    handleSubmit(e);
  };

  const handleToggleConnection = (connectionId) => {
    if (enabledConnections.includes(connectionId)) {
      // Remove connection
      setEnabledConnections(enabledConnections.filter((id) => id !== connectionId));
    } else {
      // Add connection (max 4)
      if (enabledConnections.length < 4) {
        setEnabledConnections([...enabledConnections, connectionId]);
      }
    }
  };

  // Compact inline model selector for the v2 composer — a small chip in the
  // bottom-controls row (`Premium ⌄`) that opens the three curated tiers. Mirrors
  // the v1 `model-selector-dropdown` markup but trimmed (no "Select Model" header,
  // label-only toggle). Locks via `modelLocked` after the first message so the
  // model can't change mid-conversation.
  const renderV2ModelSelector = () => {
    if (variant !== 'v2' || !showModelSelector || !setSelectedModelId) return null;

    const activeOption = WORKSPACE_MODEL_OPTIONS_CURATED.find((m) => m.id === selectedModelId);
    const activeLabel = activeOption ? t(activeOption.labelKey) : t('input.modelSelector.title');
    const isModelDisabled = isControlsDisabled || modelLocked;

    return (
      <Dropdown
        drop="up"
        className="model-selector-dropdown model-selector-dropdown-v2"
        show={showModelDropdown}
        onToggle={(isOpen) => !isModelDisabled && setShowModelDropdown(isOpen)}
      >
        <Dropdown.Toggle
          variant="link"
          className="model-selector-toggle-v2"
          disabled={isModelDisabled}
          aria-label={t('input.modelSelector.title')}
          title={t('input.tooltips.model')}
        >
          <span className="model-selector-toggle-v2-label">{activeLabel}</span>
          {activeOption?.creditNoteKey && getFlag('SHOW_CREDITS') && (
            <span
              className={`model-selector-credit-note model-credit-note-${activeOption.creditNoteVariant ?? 'neutral'}`}
            >
              {t(activeOption.creditNoteKey)}
            </span>
          )}
          <ChevronDown size={14} strokeWidth={2} className="model-selector-toggle-v2-caret" />
        </Dropdown.Toggle>

        <Dropdown.Menu
          className="model-selector-menu-v2"
          popperConfig={{
            strategy: 'fixed',
            modifiers: [
              { name: 'offset', options: { offset: [0, 8] } },
              { name: 'preventOverflow', options: { boundary: 'viewport', padding: 8, altAxis: true } },
              { name: 'flip', enabled: false },
            ],
          }}
        >
          {WORKSPACE_MODEL_OPTIONS_CURATED.map((model) => (
            <div
              key={model.id}
              className={`model-item ${selectedModelId === model.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedModelId(model.id);
                setShowModelDropdown(false);
              }}
            >
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="model-name">
                    {t(model.labelKey)}
                    {model.creditNoteKey && getFlag('SHOW_CREDITS') && (
                      <span className={`model-credit-note model-credit-note-${model.creditNoteVariant ?? 'neutral'}`}>
                        {t(model.creditNoteKey)}
                      </span>
                    )}
                  </div>
                  <div className="model-description">{t(model.descriptionKey)}</div>
                </div>
                {selectedModelId === model.id && <i className="bi bi-check-lg"></i>}
              </div>
            </div>
          ))}
        </Dropdown.Menu>
      </Dropdown>
    );
  };

  const renderUploadButton = (className = 'attachment-icon') => {
    const isV2InlineUploadButton = variant === 'v2' && className.includes('v2-inline');

    return (
      <OverlayTrigger
        placement="top"
        overlay={<Tooltip id="tooltip-file-upload">{uploadDisabledReason || t('input.tooltips.upload')}</Tooltip>}
      >
        <span className={`d-inline-block ${isV2InlineUploadButton ? 'attachment-icon-anchor-v2-inline' : ''}`}>
          <Button
            variant="link"
            className={className}
            onClick={() => setShowUploadModal(true)}
            aria-label={t('input.aria.upload')}
            disabled={isControlsDisabled || !!uploadDisabledReason}
            style={{
              ...(isV2InlineUploadButton
                ? {
                    position: 'static',
                    width: isMobile ? '30px' : '32px',
                    height: isMobile ? '30px' : '32px',
                    minHeight: isMobile ? '30px' : '32px',
                    borderRadius: '8px',
                    zIndex: 2,
                  }
                : {}),
              ...(uploadDisabledReason ? { pointerEvents: 'none' } : {}),
            }}
          >
            <Paperclip size={16} strokeWidth={2} />
          </Button>
        </span>
      </OverlayTrigger>
    );
  };

  const renderSendButton = () => {
    if (showStopButton) {
      return (
        <Button
          variant="primary"
          type="button"
          className="stop-button"
          onClick={onStop}
          disabled={isStopping}
          aria-label={t('workspace.settings.stopButton')}
        >
          {isStopping ? (
            <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" />
          ) : (
            <i className="bi bi-stop-fill"></i>
          )}
        </Button>
      );
    }

    if (showSendSpinner) {
      return (
        <Button
          variant="primary"
          type="submit"
          id="send-message-button"
          disabled={true}
          className="send-button spinner-button-bold"
          aria-label={t('workspace.settings.sendingButton')}
        >
          <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
        </Button>
      );
    }

    // V2: show mic button in place of send when input is empty
    if (showVoiceMicAsSend) {
      return (
        <VoiceRecordButton
          onRecordingComplete={onVoiceRecordingComplete!}
          disabled={isControlsDisabled}
          isV2Inline={false}
          isMobile={isMobile}
          externalState={voiceRecordingState}
          asSendButton
          sendButtonSize={isMobile ? '40px' : '52px'}
        />
      );
    }

    return (
      <Button
        variant="primary"
        type="submit"
        id="send-message-button"
        className="send-button"
        disabled={isSendDisabled || !inputMessage.trim()}
        aria-label={t('workspace.settings.sendButton')}
        style={
          variant === 'v2'
            ? {
                width: isMobile ? '40px' : '52px',
                height: isMobile ? '40px' : '52px',
                minWidth: isMobile ? '40px' : '52px',
                minHeight: isMobile ? '40px' : '52px',
                flex: `0 0 ${isMobile ? '40px' : '52px'}`,
              }
            : undefined
        }
      >
        {variant === 'v2' ? <Send size={18} strokeWidth={2.1} /> : <i className="bi bi-arrow-up-circle-fill"></i>}
      </Button>
    );
  };

  // When controls are mounted in the v2 inline-tools cluster, the textarea needs
  // extra right-padding so typed text doesn't slide under them. Base reservation
  // covers the paperclip; the chat-health slot and the model-tier chip each add
  // their own width on top. The reservation is published as the `--v2-textarea-pad-right`
  // custom property because the textarea's padding is locked by an `!important` rule
  // in the stylesheet — a plain inline `padding` would lose to it, so the SCSS reads
  // the var instead (see `.chat-textarea-v2` in _chat_v2_overrides.scss).
  const showV2ModelSelector = variant === 'v2' && showModelSelector && !!setSelectedModelId;
  // On mobile the inline tools move to a toolbar *below* the textarea, so the
  // textarea no longer reserves right-side space for an overlay — just normal padding.
  const v2InlineToolsWidth = isMobile ? 16 : (chatHealthSlot ? 104 : 44) + (showV2ModelSelector ? 92 : 0);
  const v2TextareaStyle =
    variant === 'v2'
      ? ({
          minHeight: `${v2BaseHeight}px`,
          maxHeight: isMobile ? '46vh' : '56vh',
          fontSize: '0.875rem',
          lineHeight: isMobile ? '1.2rem' : '1.25rem',
          padding: isMobile ? `10px ${v2InlineToolsWidth}px 10px 14px` : `12px ${v2InlineToolsWidth}px 12px 16px`,
          width: '100%',
          display: 'block',
          boxSizing: 'border-box' as const,
          overflowY: 'hidden' as const,
          '--v2-textarea-pad-right': `${v2InlineToolsWidth}px`,
        } as React.CSSProperties)
      : undefined;

  return (
    <div
      className={`chat-input-container ${variant === 'v2' ? 'chat-input-container-v2' : ''}`}
      style={{ marginTop: '1px' }}
    >
      <Form onSubmit={handleFormSubmit} className="d-flex flex-column">
        {/* Row 1: Input Box */}
        <div style={{ position: 'relative' }}>
          {variant === 'v2' ? (
            <div className="chat-input-main-row">
              <div className="chat-input-textarea-wrap">
                <div className="chat-input-textarea-resize-handle" onMouseDown={handleV2ResizeStart} />
                <textarea
                  ref={inputRef}
                  value={inputMessage}
                  onInput={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={placeholderText}
                  disabled={isTextInputDisabled}
                  className="chat-textarea chat-textarea-v2"
                  rows={1}
                  style={v2TextareaStyle}
                />
                {isMobile ? (
                  // Mobile: tools + send/mic sit on a row below the textarea (inside the box).
                  <div className="chat-input-mobile-toolbar">
                    <div className="chat-input-inline-tools">
                      {renderV2ModelSelector()}
                      {renderUploadButton('attachment-icon v2-inline')}
                      {chatHealthSlot}
                    </div>
                    <div className="chat-input-inline-actions">{renderSendButton()}</div>
                  </div>
                ) : (
                  // Desktop: tools overlay the textarea's bottom-right; send sits outside.
                  <div className="chat-input-inline-tools">
                    {renderV2ModelSelector()}
                    {renderUploadButton('attachment-icon v2-inline')}
                    {chatHealthSlot}
                  </div>
                )}
              </div>
              {!isMobile && <div className="chat-input-inline-actions">{renderSendButton()}</div>}
            </div>
          ) : (
            <Form.Control
              as="textarea"
              ref={inputRef}
              value={inputMessage}
              onInput={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholderText}
              disabled={isTextInputDisabled}
              className="chat-textarea"
              rows={1}
            />
          )}
        </div>

        {variant === 'v2' && !isMobile && <div className="chat-input-helper-text">{t('input.submitHint')}</div>}

        {/* Row 2: Buttons & Toggles (V1 only) */}
        {variant === 'v1' && (
          <div className="input-controls">
            <div className="left-controls">
              {/* Attachment Button & Numa Files folder selector */}
              {renderUploadButton()}
              {chatHealthSlot}
              <FeatureWrapper requiredFeature="useCompanyData">
                <>
                  {/* V1 only: folder dropdown (V2 has folder picker in settings panel) */}
                  {variant === 'v1' && (
                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip id="tooltip-knowledge-bases">{t('input.tooltips.knowledgeBases')}</Tooltip>}
                    >
                      <Dropdown
                        drop={dropdownDirection as DropDirection}
                        className="kb-selector-compact-dropdown"
                        show={showKBDropdown}
                        onToggle={(isOpen) => setShowKBDropdown(isOpen)}
                      >
                        <Dropdown.Toggle
                          variant="link"
                          className={`kb-selector-compact-toggle ${enabledKBIds.length > 0 ? 'active' : ''}`}
                          disabled={isControlsDisabled}
                          aria-label={t('input.aria.knowledgeBase')}
                        >
                          <i className="bi bi-folder2-open"></i>
                          {enabledKBIds.length > 0 && (
                            <span
                              className="kb-active-indicators"
                              style={{
                                position: 'absolute',
                                top: '2px',
                                right: '2px',
                                display: 'flex',
                                gap: '2px',
                              }}
                            >
                              {Array.from({ length: Math.min(enabledKBIds.length, 3) }).map((_, i) => (
                                <span
                                  key={i}
                                  style={{
                                    width: '6px',
                                    height: '6px',
                                    borderRadius: '50%',
                                    backgroundColor: 'var(--brand-primary, var(--color-primary))',
                                  }}
                                ></span>
                              ))}
                            </span>
                          )}
                        </Dropdown.Toggle>

                        <Dropdown.Menu
                          className="p-3 kb-dropdown-menu"
                          style={{ minWidth: '280px', zIndex: 9999 }}
                          popperConfig={{
                            strategy: 'fixed',
                            modifiers: [
                              {
                                name: 'offset',
                                options: {
                                  offset: [0, 8], // [skidding, distance] - 8px gap above button
                                },
                              },
                              {
                                name: 'preventOverflow',
                                options: {
                                  boundary: 'viewport',
                                  padding: 8,
                                  altAxis: true, // Allow horizontal adjustment to avoid clipping on narrow screens
                                },
                              },
                              {
                                name: 'flip',
                                enabled: false, // Disable flip to force it to stay above
                              },
                            ],
                          }}
                        >
                          {/* Mobile Close Button */}
                          <div className="kb-mobile-header d-md-none">
                            <span className="kb-header-title">{t('input.kb.title')}</span>
                            <Button
                              variant="link"
                              className="kb-close-button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setShowKBDropdown(false);
                              }}
                              aria-label={t('input.aria.close')}
                            >
                              <i className="bi bi-x-lg"></i>
                            </Button>
                          </div>

                          {/* KB Selection */}
                          <Dropdown.Header className="d-none d-md-block">{t('input.kb.available')}</Dropdown.Header>
                          {isLoadingKBs ? (
                            <div className="text-center py-2">
                              <Spinner animation="border" size="sm" />
                            </div>
                          ) : availableKBs.length === 0 ? (
                            <div className="px-3 py-2 text-muted">{t('input.kb.empty')}</div>
                          ) : (
                            availableKBs.map((kb) => (
                              <div key={kb.kb_id} className="kb-item">
                                <Form.Check
                                  type="switch"
                                  id={`kb-switch-${kb.kb_id}`}
                                  label={
                                    <div className="kb-label-container">
                                      <div className="kb-info">
                                        <i className="bi bi-folder2-open kb-icon"></i>
                                        <span className="kb-name">{getKnowledgeBaseLabel(kb)}</span>
                                        {kb.kb_id === 'company' && (
                                          <Badge bg="" className="badge-outline ms-2" style={{ fontSize: '0.65rem' }}>
                                            {t('input.kb.defaultBadge')}
                                          </Badge>
                                        )}
                                      </div>
                                      <Badge
                                        bg=""
                                        className={`kb-role-badge ${kb.role === 'OWNER' ? 'badge-outline-primary' : 'badge-outline'}`}
                                        style={{ fontSize: '0.65rem' }}
                                      >
                                        {getKnowledgeBaseRoleLabel(kb.role)}
                                      </Badge>
                                    </div>
                                  }
                                  checked={enabledKBIds.includes(kb.kb_id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setEnabledKBIds([...enabledKBIds, kb.kb_id]);
                                    } else {
                                      setEnabledKBIds(enabledKBIds.filter((id) => id !== kb.kb_id));
                                    }
                                  }}
                                />
                              </div>
                            ))
                          )}

                          <Dropdown.Divider />
                          <Dropdown.Item onClick={() => refreshKBs()}>
                            <i className="bi bi-arrow-clockwise me-2"></i>
                            {t('input.kb.refresh')}
                          </Dropdown.Item>
                        </Dropdown.Menu>
                      </Dropdown>
                    </OverlayTrigger>
                  )}
                </>
              </FeatureWrapper>

              {/* V2: Settings Toggle Button (opens/closes right panel) */}
              {variant === 'v2' && onSettingsClick && (
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip id="tooltip-settings">{t('input.tooltips.settings')}</Tooltip>}
                >
                  <Button
                    variant="link"
                    className={`settings-toggle-btn ${isSettingsPanelOpen ? 'panel-open' : ''} ${hasActiveSettings ? 'has-active' : ''}`}
                    onClick={onSettingsClick}
                    aria-label={t('input.tooltips.settings')}
                    aria-pressed={isSettingsPanelOpen}
                    disabled={isControlsDisabled}
                  >
                    <i className="bi bi-sliders"></i>
                  </Button>
                </OverlayTrigger>
              )}

              {/* Tools Settings Dropup - V1 only (V2 has tools in settings panel) */}
              {variant === 'v1' && autoToolsEnabled !== undefined && setAutoToolsEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <OverlayTrigger
                    placement="top"
                    overlay={<Tooltip id="tooltip-tools">{t('input.tooltips.tools')}</Tooltip>}
                  >
                    <Dropdown
                      drop={dropdownDirection}
                      className="tools-settings-dropdown"
                      show={showToolsDropdown}
                      onToggle={(isOpen) => setShowToolsDropdown(isOpen)}
                    >
                      <Dropdown.Toggle
                        variant="link"
                        className={`tools-settings-toggle ${
                          autoToolsEnabled || webSearchEnabled || (agentsFeatureEnabled && createAgentEnabled)
                            ? 'active'
                            : ''
                        }`}
                        disabled={isControlsDisabled}
                        aria-label={t('input.aria.toolsSettings')}
                      >
                        <i className="bi bi-tools"></i>
                      </Dropdown.Toggle>

                      <Dropdown.Menu
                        className="p-3 tools-dropdown-menu"
                        style={{
                          minWidth: 'min(480px, calc(100vw - 1rem))',
                          maxWidth: 'calc(100vw - 1rem)',
                          zIndex: 9999,
                        }}
                        renderOnMount={isMobile}
                        popperConfig={{
                          strategy: 'fixed',
                          modifiers: [
                            {
                              name: 'offset',
                              options: {
                                offset: [0, 8],
                              },
                            },
                            {
                              name: 'preventOverflow',
                              options: {
                                boundary: 'viewport',
                                padding: 8,
                                altAxis: false, // Prevent horizontal shifting - keep centered
                              },
                            },
                            {
                              name: 'flip',
                              enabled: false,
                            },
                          ],
                        }}
                      >
                        {/* Mobile Close Button */}
                        <div className="tools-mobile-header d-md-none">
                          <span className="tools-header-title">{t('input.tools.title')}</span>
                          <Button
                            variant="link"
                            className="tools-close-button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setShowToolsDropdown(false);
                            }}
                            aria-label={t('input.aria.close')}
                          >
                            <i className="bi bi-x-lg"></i>
                          </Button>
                        </div>

                        <div className="mb-3">
                          <Form.Check
                            type="switch"
                            id="auto-tools-switch"
                            label={t('input.tools.allTools')}
                            checked={autoToolsEnabled}
                            onChange={(e) => setAutoToolsEnabled(e.target.checked)}
                            className="mb-2"
                          />
                          <small className="text-muted d-block mb-3">{t('input.tools.allToolsDescription')}</small>
                        </div>

                        <hr className="my-2" />
                        <div className="mb-3">
                          <Form.Check
                            type="switch"
                            id="web-search-switch"
                            label={
                              <span className="tool-label">
                                <Search size={16} className="me-2" />
                                <span className="tool-name">{t('input.tools.webSearch.title')}</span>
                                <span className="tool-separator"> - </span>
                                <span className="tool-description">{t('input.tools.webSearch.description')}</span>
                              </span>
                            }
                            checked={autoToolsEnabled || webSearchEnabled}
                            onChange={(e) => !autoToolsEnabled && setWebSearchEnabled(e.target.checked)}
                            disabled={autoToolsEnabled}
                          />
                        </div>
                        {agentsFeatureEnabled && (
                          <div className="mb-3">
                            <Form.Check
                              type="switch"
                              id="agent-creation-switch"
                              label={
                                <span className="tool-label">
                                  <Robot size={16} className="me-2" />
                                  <span className="tool-name">{t('input.tools.agentCreation.title')}</span>
                                  <span className="tool-separator"> - </span>
                                  <span className="tool-description">{t('input.tools.agentCreation.description')}</span>
                                </span>
                              }
                              checked={autoToolsEnabled || createAgentEnabled}
                              onChange={(e) => !autoToolsEnabled && setCreateAgentEnabled(e.target.checked)}
                              disabled={autoToolsEnabled}
                            />
                          </div>
                        )}

                        {!autoToolsEnabled &&
                          enabledKBIds.length === 0 &&
                          !webSearchEnabled &&
                          !(agentsFeatureEnabled && createAgentEnabled) && (
                            <div className="mt-2 p-2 bg-light rounded">
                              <small className="text-muted">{t('input.tools.selectSpecific')}</small>
                            </div>
                          )}
                      </Dropdown.Menu>
                    </Dropdown>
                  </OverlayTrigger>
                  {/* Tool indicators positioned next to button */}
                  {(autoToolsEnabled || webSearchEnabled || (agentsFeatureEnabled && createAgentEnabled)) && (
                    <span className="active-tools-indicators" style={{ display: 'flex', gap: '0.25rem' }}>
                      {(autoToolsEnabled || webSearchEnabled) && <Search size={12} />}
                      {(autoToolsEnabled || (agentsFeatureEnabled && createAgentEnabled)) && <Robot size={12} />}
                    </span>
                  )}
                </div>
              )}

              {/* Model Selector (V1 only) */}
              {variant === 'v1' && showModelSelector && setSelectedModelId && (
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip id="tooltip-model">{t('input.tooltips.model')}</Tooltip>}
                >
                  <Dropdown
                    drop={dropdownDirection}
                    className="model-selector-dropdown"
                    show={showModelDropdown}
                    onToggle={(isOpen) => setShowModelDropdown(isOpen)}
                  >
                    <Dropdown.Toggle
                      variant="link"
                      disabled={isControlsDisabled}
                      aria-label={t('input.modelSelector.title')}
                    >
                      <i className="bi bi-cpu"></i>
                      {selectedModelId && (
                        <span className="model-indicator">
                          {WORKSPACE_MODEL_OPTIONS.find((m) => m.id === selectedModelId)?.label.replace(
                            'Claude ',
                            ''
                          ) || 'Sonnet'}
                        </span>
                      )}
                    </Dropdown.Toggle>

                    <Dropdown.Menu
                      popperConfig={{
                        strategy: 'fixed',
                        modifiers: [
                          { name: 'offset', options: { offset: [0, 8] } },
                          { name: 'preventOverflow', options: { boundary: 'viewport', padding: 8, altAxis: true } },
                          { name: 'flip', enabled: false },
                        ],
                      }}
                    >
                      {/* Mobile Close Button */}
                      <div className="model-mobile-header d-md-none">
                        <span className="model-header-title">{t('input.modelSelector.mobileTitle')}</span>
                        <Button
                          variant="link"
                          className="model-close-button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowModelDropdown(false);
                          }}
                          aria-label={t('input.aria.close')}
                        >
                          <i className="bi bi-x-lg"></i>
                        </Button>
                      </div>

                      <Dropdown.Header className="d-none d-md-block">{t('input.modelSelector.title')}</Dropdown.Header>
                      {WORKSPACE_MODEL_OPTIONS.map((model) => (
                        <div
                          key={model.id}
                          className={`model-item ${selectedModelId === model.id ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedModelId(model.id);
                            setShowModelDropdown(false);
                          }}
                        >
                          <div className="d-flex justify-content-between align-items-center">
                            <div>
                              <div className="model-name">{model.label}</div>
                              <div className="model-description">{model.description}</div>
                            </div>
                            {selectedModelId === model.id && <i className="bi bi-check-lg"></i>}
                          </div>
                        </div>
                      ))}
                    </Dropdown.Menu>
                  </Dropdown>
                </OverlayTrigger>
              )}

              {/* Integrations Toggle - V1 only (V2 has integrations in settings panel) */}
              {variant === 'v1' && hasPipedreamFeature && (
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip id="tooltip-integrations">{t('input.tooltips.integrations')}</Tooltip>}
                >
                  <Button
                    variant="link"
                    className={`connections-toggle ${enabledConnections.length > 0 ? 'active' : ''}`}
                    onClick={() => setShowConnectionsModal(true)}
                    aria-label={t('input.integrations.toggleAria')}
                    disabled={isControlsDisabled || connectionsLoading}
                  >
                    {connectionsLoading && (
                      <>
                        <i className="bi bi-link-45deg"></i>
                        <Spinner
                          as="span"
                          animation="border"
                          size="sm"
                          className="connections-loading-spinner"
                          role="status"
                          aria-hidden="true"
                        />
                      </>
                    )}
                    {!connectionsLoading && (
                      <>
                        {/* Show icon always */}
                        <i className="bi bi-link-45deg"></i>
                        {/* Show enabled connection icons */}
                        {enabledConnections.length > 0 && (
                          <span className="connection-icons">
                            {visibleConnectionIds.map((connectionId) => {
                              const connection = availableConnections.find((conn) => conn.id === connectionId);
                              return connection ? (
                                <span key={connectionId} className="connection-icon">
                                  <img
                                    src={getConnectionIcon(connection.id)}
                                    alt={connection.name}
                                    style={{ width: '20px', height: '20px' }}
                                    onError={(e) => {
                                      const img = e.currentTarget as HTMLImageElement;
                                      img.style.display = 'none';
                                      const fallback = img.nextElementSibling as HTMLElement | null;
                                      if (fallback) fallback.style.display = 'inline-block';
                                    }}
                                  />
                                  <i
                                    className={`${getConnectionFallbackIcon(connection.id)} text-${getConnectionFallbackColor(connection.id)}`}
                                    style={{ fontSize: '20px', display: 'none' }}
                                  />
                                </span>
                              ) : null;
                            })}
                            {hiddenConnectionCount > 0 && (
                              <Badge bg="secondary" pill className="connection-more-badge">
                                +{hiddenConnectionCount}
                              </Badge>
                            )}
                          </span>
                        )}
                      </>
                    )}
                  </Button>
                </OverlayTrigger>
              )}
            </div>
            <div className="right-controls">{renderSendButton()}</div>
          </div>
        )}
      </Form>

      {/* Integrations Selection Modal */}
      <Modal show={showConnectionsModal} onHide={() => setShowConnectionsModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('input.integrations.modalTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">{t('input.integrations.modalDescription')}</p>
          {connectionsLoading ? (
            <p className="text-muted text-center">{t('input.integrations.loading')}</p>
          ) : availableConnections.length === 0 ? (
            <p className="text-muted text-center">{t('input.integrations.empty')}</p>
          ) : (
            <div className="d-flex flex-column gap-3">
              {availableConnections
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((connection) => {
                  const isEnabled = enabledConnections.includes(connection.id);
                  const canToggle = !isEnabled || enabledConnections.length > 1;

                  return (
                    <div key={connection.id} className="border rounded" style={{ background: '#fff' }}>
                      <div className="d-flex align-items-center justify-content-between p-3">
                        <div className="d-flex align-items-center gap-3">
                          <img
                            src={getConnectionIcon(connection.id)}
                            alt={connection.name}
                            style={{ width: '24px', height: '24px' }}
                            onError={(e) => {
                              const img = e.currentTarget as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = img.nextElementSibling as HTMLElement | null;
                              if (fallback) fallback.style.display = 'inline-block';
                            }}
                          />
                          <i
                            className={`${getConnectionFallbackIcon(connection.id)} text-${getConnectionFallbackColor(connection.id)}`}
                            style={{ fontSize: '24px', display: 'none' }}
                          />
                          <div>
                            <div className="fw-bold d-flex align-items-center gap-2">
                              {getConnectionDisplayName(connection.id)}
                              <IntegrationAccountButton
                                connectionId={connection.id}
                                displayName={getConnectionDisplayName(connection.id)}
                                accounts={connection.accounts ?? []}
                                allowMultipleAccounts={connection.allowMultipleAccounts === true}
                                isEnabled={isEnabled}
                                selectedAccountIds={selectedAccountsByApp[connection.id]}
                                onChange={(next) =>
                                  setSelectedAccountsByApp?.((prev) => ({ ...prev, [connection.id]: next }))
                                }
                              />
                            </div>
                            <div className="text-muted small">{t('input.integrations.connected')}</div>
                          </div>
                        </div>
                        <Button
                          variant={isEnabled ? 'success' : 'outline-primary'}
                          size="sm"
                          disabled={!canToggle && !isEnabled}
                          onClick={() => handleToggleConnection(connection.id)}
                        >
                          {isEnabled ? t('input.integrations.enabled') : t('input.integrations.enable')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
};

// Memoize to prevent re-renders when parent state changes but ChatInput props haven't
const MemoizedChatInput = React.memo(ChatInput);
MemoizedChatInput.displayName = 'ChatInput';

export { MemoizedChatInput as ChatInput };
