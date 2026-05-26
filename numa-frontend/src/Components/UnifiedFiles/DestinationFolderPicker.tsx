import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { UserKB } from '../../Services/knowledgeBaseService';

export interface DestinationFolderPickerValue {
  kbId: string;
  folderPath: string;
}

interface KBOption {
  kb: UserKB;
  displayName: string;
}

interface DestinationFolderPickerProps {
  /** KBs the user can pick as destinations. */
  kbOptions: KBOption[];
  /** Optional special "root" KB pinned to the top (eg Personal/My Files). */
  rootKBOption?: KBOption | null;
  /** Currently selected destination. */
  value: DestinationFolderPickerValue | null;
  /** Fires whenever the user changes the destination. */
  onChange: (value: DestinationFolderPickerValue) => void;
  /** Lazy fetch of folder paths for a given KB. Returns flat shallower-first list. */
  loadFoldersForKB: (kbId: string) => Promise<string[]>;
  /** Lock the picker to a single KB (no KB switching). */
  lockedKbId?: string;
  /** Disable specific KBs (eg the source KB during a move, or KBs already containing source files). */
  disabledKbIds?: Set<string>;
  /** Disable specific folder paths within the current KB (eg the source folders themselves). */
  disabledFolderPaths?: string[];
  /** Optional label shown above the picker. */
  label?: string;
  /** Optional helper text shown below the breadcrumb. */
  helpText?: string;
  /** Optional Create-folder action shown beside the breadcrumb at the KB-list view. */
  onCreateFolder?: () => void;
  /** Auto-pick the first KB when there's only one option. */
  autoPickSingleKb?: boolean;
}

const NO_FOLDERS_AT_LEVEL: string[] = [];

function childrenAtPath(allFolders: string[], currentPath: string): string[] {
  const prefix = currentPath ? `${currentPath}/` : '';
  const direct = new Set<string>();
  for (const folder of allFolders) {
    if (!folder.startsWith(prefix)) continue;
    const remainder = folder.slice(prefix.length);
    if (!remainder) continue;
    const slash = remainder.indexOf('/');
    direct.add(slash === -1 ? remainder : remainder.slice(0, slash));
  }
  return Array.from(direct).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function DestinationFolderPicker({
  kbOptions,
  rootKBOption,
  value,
  onChange,
  loadFoldersForKB,
  lockedKbId,
  disabledKbIds,
  disabledFolderPaths,
  label,
  helpText,
  onCreateFolder,
  autoPickSingleKb,
}: DestinationFolderPickerProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');

  const [folderCache, setFolderCache] = useState<Map<string, string[]>>(new Map());
  const [loadingKbs, setLoadingKbs] = useState<Set<string>>(new Set());
  const [errorKbs, setErrorKbs] = useState<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());

  const allKbOptions = useMemo(() => {
    const out: KBOption[] = [];
    if (rootKBOption) out.push(rootKBOption);
    for (const opt of kbOptions) {
      if (rootKBOption && opt.kb.kb_id === rootKBOption.kb.kb_id) continue;
      out.push(opt);
    }
    return out;
  }, [kbOptions, rootKBOption]);

  const activeKb = useMemo(() => {
    if (!value) return null;
    return allKbOptions.find((opt) => opt.kb.kb_id === value.kbId) ?? null;
  }, [allKbOptions, value]);

  const fetchFolders = useCallback(
    (kbId: string) => {
      if (folderCache.has(kbId) || inFlightRef.current.has(kbId)) return;
      inFlightRef.current.add(kbId);
      setLoadingKbs((prev) => {
        const next = new Set(prev);
        next.add(kbId);
        return next;
      });
      setErrorKbs((prev) => {
        const next = new Set(prev);
        next.delete(kbId);
        return next;
      });
      loadFoldersForKB(kbId)
        .then((folders) => {
          setFolderCache((prev) => {
            const next = new Map(prev);
            next.set(kbId, folders);
            return next;
          });
        })
        .catch(() => {
          setErrorKbs((prev) => {
            const next = new Set(prev);
            next.add(kbId);
            return next;
          });
        })
        .finally(() => {
          inFlightRef.current.delete(kbId);
          setLoadingKbs((prev) => {
            const next = new Set(prev);
            next.delete(kbId);
            return next;
          });
        });
    },
    [folderCache, loadFoldersForKB]
  );

  useEffect(() => {
    if (activeKb) fetchFolders(activeKb.kb.kb_id);
  }, [activeKb, fetchFolders]);

  useEffect(() => {
    if (lockedKbId && (!value || value.kbId !== lockedKbId)) {
      onChange({ kbId: lockedKbId, folderPath: value?.folderPath ?? '' });
    }
  }, [lockedKbId, value, onChange]);

  useEffect(() => {
    if (!autoPickSingleKb || lockedKbId || value) return;
    if (allKbOptions.length !== 1) return;
    const only = allKbOptions[0];
    if (disabledKbIds?.has(only.kb.kb_id)) return;
    onChange({ kbId: only.kb.kb_id, folderPath: '' });
  }, [allKbOptions, autoPickSingleKb, disabledKbIds, lockedKbId, onChange, value]);

  const setKbAndPath = useCallback(
    (kbId: string, folderPath: string) => {
      onChange({ kbId, folderPath });
    },
    [onChange]
  );

  const goToKbList = useCallback(() => {
    if (lockedKbId) return;
    onChange({ kbId: '', folderPath: '' });
  }, [lockedKbId, onChange]);

  const showingKbList = !activeKb;
  const currentFolders = activeKb ? (folderCache.get(activeKb.kb.kb_id) ?? NO_FOLDERS_AT_LEVEL) : NO_FOLDERS_AT_LEVEL;
  const isLoading = activeKb ? loadingKbs.has(activeKb.kb.kb_id) : false;
  const hasError = activeKb ? errorKbs.has(activeKb.kb.kb_id) : false;

  const breadcrumbSegments = useMemo(() => {
    if (!activeKb || !value) return [];
    const segs: { label: string; path: string }[] = [];
    if (value.folderPath) {
      const parts = value.folderPath.split('/');
      let acc = '';
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        segs.push({ label: part, path: acc });
      }
    }
    return segs;
  }, [activeKb, value]);

  const childFolderNames = useMemo(() => {
    if (!activeKb) return [];
    return childrenAtPath(currentFolders, value?.folderPath ?? '');
  }, [activeKb, currentFolders, value?.folderPath]);

  const disabledPathSet = useMemo(() => new Set(disabledFolderPaths ?? []), [disabledFolderPaths]);

  return (
    <div className="destination-folder-picker">
      {label && <div className="destination-folder-picker__label">{label}</div>}

      {/* Breadcrumb / KB switcher */}
      <div className="destination-folder-picker__breadcrumb">
        {showingKbList ? (
          <span className="destination-folder-picker__crumb destination-folder-picker__crumb--current">
            <i className="bi bi-folder2-open me-1" />
            {t('destinationPicker.kbListTitle', { defaultValue: 'Choose a folder' })}
          </span>
        ) : (
          <>
            {!lockedKbId && (
              <button
                type="button"
                className="destination-folder-picker__crumb destination-folder-picker__crumb--button"
                onClick={goToKbList}
              >
                <i className="bi bi-house-door me-1" />
                {t('destinationPicker.allFolders', { defaultValue: 'All folders' })}
              </button>
            )}
            {!lockedKbId && <span className="destination-folder-picker__sep">/</span>}
            <button
              type="button"
              className={
                breadcrumbSegments.length === 0
                  ? 'destination-folder-picker__crumb destination-folder-picker__crumb--current'
                  : 'destination-folder-picker__crumb destination-folder-picker__crumb--button'
              }
              onClick={() => activeKb && setKbAndPath(activeKb.kb.kb_id, '')}
              disabled={breadcrumbSegments.length === 0}
            >
              <i className={`bi ${activeKb?.kb.is_root ? 'bi-person-circle' : 'bi-folder-fill'} me-1`} />
              {activeKb?.displayName}
            </button>
            {breadcrumbSegments.map((seg, idx) => {
              const isLast = idx === breadcrumbSegments.length - 1;
              return (
                <React.Fragment key={seg.path}>
                  <span className="destination-folder-picker__sep">/</span>
                  <button
                    type="button"
                    className={
                      isLast
                        ? 'destination-folder-picker__crumb destination-folder-picker__crumb--current'
                        : 'destination-folder-picker__crumb destination-folder-picker__crumb--button'
                    }
                    onClick={() => activeKb && setKbAndPath(activeKb.kb.kb_id, seg.path)}
                    disabled={isLast}
                  >
                    {seg.label}
                  </button>
                </React.Fragment>
              );
            })}
          </>
        )}
        {showingKbList && onCreateFolder && (
          <button type="button" className="destination-folder-picker__create-btn" onClick={onCreateFolder}>
            <i className="bi bi-folder-plus me-1" />
            {t('destinationPicker.newFolder', { defaultValue: 'New folder' })}
          </button>
        )}
      </div>

      {/* List */}
      <div className="destination-folder-picker__list">
        {showingKbList ? (
          allKbOptions.length === 0 ? (
            <div className="destination-folder-picker__empty">
              {t('destinationPicker.noKbs', { defaultValue: 'No folders available.' })}
            </div>
          ) : (
            allKbOptions.map((opt) => {
              const disabled = disabledKbIds?.has(opt.kb.kb_id) ?? false;
              return (
                <button
                  key={opt.kb.kb_id}
                  type="button"
                  className="destination-folder-picker__row"
                  onClick={() => setKbAndPath(opt.kb.kb_id, '')}
                  disabled={disabled}
                  title={disabled ? t('destinationPicker.kbDisabled', { defaultValue: 'Not available' }) : undefined}
                >
                  <i
                    className={`bi ${opt.kb.is_root ? 'bi-person-circle' : 'bi-folder-fill'} destination-folder-picker__row-icon`}
                  />
                  <span className="destination-folder-picker__row-name">{opt.displayName}</span>
                  {opt.kb.is_shared && (
                    <span className="destination-folder-picker__row-badge">
                      <i className="bi bi-people-fill" />
                    </span>
                  )}
                  <i className="bi bi-chevron-right destination-folder-picker__row-chev" />
                </button>
              );
            })
          )
        ) : isLoading && childFolderNames.length === 0 ? (
          <div className="destination-folder-picker__loading">
            <Spinner animation="border" size="sm" variant="secondary" />
            <span>{t('destinationPicker.loading', { defaultValue: 'Loading folders…' })}</span>
          </div>
        ) : hasError ? (
          <div className="destination-folder-picker__empty destination-folder-picker__empty--error">
            {t('destinationPicker.loadError', { defaultValue: 'Could not load folders.' })}
          </div>
        ) : childFolderNames.length === 0 ? (
          <div className="destination-folder-picker__empty">
            {t('destinationPicker.noSubfolders', {
              defaultValue: 'No subfolders here. Files will land in this folder.',
            })}
          </div>
        ) : (
          childFolderNames.map((name) => {
            const childPath = value?.folderPath ? `${value.folderPath}/${name}` : name;
            const childDisabled = disabledPathSet.has(childPath);
            return (
              <button
                key={childPath}
                type="button"
                className="destination-folder-picker__row"
                onClick={() => activeKb && setKbAndPath(activeKb.kb.kb_id, childPath)}
                disabled={childDisabled}
                title={
                  childDisabled ? t('destinationPicker.folderDisabled', { defaultValue: 'Not available' }) : undefined
                }
              >
                <i className="bi bi-folder-fill destination-folder-picker__row-icon" />
                <span className="destination-folder-picker__row-name">{name}</span>
                <i className="bi bi-chevron-right destination-folder-picker__row-chev" />
              </button>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div className="destination-folder-picker__footer">
        {!showingKbList && activeKb && (
          <span className="destination-folder-picker__hint">
            <i className="bi bi-check2 me-1" />
            {value?.folderPath
              ? t('destinationPicker.willUploadInto', {
                  defaultValue: 'Files will be placed in {{path}}',
                  path: `${activeKb.displayName}/${value.folderPath}`,
                })
              : t('destinationPicker.willUploadIntoRoot', {
                  defaultValue: 'Files will be placed at the root of {{name}}',
                  name: activeKb.displayName,
                })}
          </span>
        )}
        {helpText && <span className="destination-folder-picker__help">{helpText}</span>}
      </div>
    </div>
  );
}

export default DestinationFolderPicker;
