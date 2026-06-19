/**
 * Embedded single-provider browser used by User Files when the user clicks
 * into an integration "folder". Replaces the standalone Remote tab as the
 * surface where integration contents live.
 *
 * Why a wrapper: OAuth providers use the self-contained `RemoteProviderTree`
 * (inline expansion, its own state via `useRemoteTree`), but Synergy is PAT-
 * backed and uses a fundamentally different jobs → folders → files flow that
 * is handled by `RemoteProviderInlineRows`. This component picks the right inner
 * experience by provider id so the parent surface stays oblivious.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, InputGroup } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../Providers/ToastContext';
import { ConnectorsService } from '../../../Services/ConnectorsService';
import { extractApiError } from '../../../utils/extractApiError';
import { getFlag } from '../../../utils/featureFlags';
import type { RemoteFileItem } from '../../Files/FileContextMenu';
import { EmailViewerModal } from '../../Files/EmailViewerModal';
import { RemoteProviderInlineRows } from './RemoteProviderInlineRows';
import { RemoteProviderTree } from './RemoteProviderTree';

interface RemoteProviderBrowserProps {
  providerId: string;
  providerName: string;
  /** Bootstrap icon class (e.g. `bi bi-google`) — already prefixed. */
  providerIcon?: string;
  /** Controlled sub-folder navigation path. Empty = at the integration's
   *  root. Owned by the parent (UserFilesTab) so the breadcrumb can render
   *  inline in the page toolbar instead of as a second header bar. */
  subFolderPath: SubFolderBreadcrumb[];
  onSubFolderPathChange: (path: SubFolderBreadcrumb[]) => void;
}

const SYNERGY_PROVIDER_ID = 'synergy';

export interface SubFolderBreadcrumb {
  id: string;
  name: string;
}

export function RemoteProviderBrowser({
  providerId,
  providerName,
  providerIcon,
  subFolderPath,
  onSubFolderPathChange,
}: RemoteProviderBrowserProps): React.JSX.Element {
  if (providerId === SYNERGY_PROVIDER_ID) {
    return <SynergyEmbeddedBrowser subFolderPath={subFolderPath} onSubFolderPathChange={onSubFolderPathChange} />;
  }
  return (
    <OAuthEmbeddedBrowser
      providerId={providerId}
      providerName={providerName}
      providerIcon={providerIcon}
      subFolderPath={subFolderPath}
      onSubFolderPathChange={onSubFolderPathChange}
    />
  );
}

// ---------------------------------------------------------------------------
// OAuth path — RemoteProviderTree is self-contained; we just route file
// download + email-view side-effects through their respective modals.
// ---------------------------------------------------------------------------

function OAuthEmbeddedBrowser({
  providerId,
  providerName,
  providerIcon,
  subFolderPath,
  onSubFolderPathChange,
}: {
  providerId: string;
  providerName: string;
  providerIcon?: string;
  subFolderPath: SubFolderBreadcrumb[];
  onSubFolderPathChange: (path: SubFolderBreadcrumb[]) => void;
}): React.JSX.Element {
  const { t } = useTranslation('files');
  const { showToast } = useToast();
  const [emailViewer, setEmailViewer] = useState<{ provider: string; fileId: string; fileName: string } | null>(null);

  const downloadRemoteFile = useCallback(
    async (item: RemoteFileItem) => {
      try {
        const provider = item.oauthProvider || providerId;
        const blob = await ConnectorsService.files.download(provider, item.file_id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.name;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        showToast({
          message: extractApiError(err, t('remote.errors.downloadFailed', 'Failed to download file')),
          variant: 'error',
        });
      }
    },
    [providerId, showToast, t]
  );

  const handleEmailView = useCallback((provider: string, fileId: string, fileName: string) => {
    setEmailViewer({ provider, fileId, fileName });
  }, []);

  const handleDrillIn = useCallback(
    (folder: { folder_id: string; name: string }) => {
      onSubFolderPathChange([...subFolderPath, { id: folder.folder_id, name: folder.name }]);
    },
    [subFolderPath, onSubFolderPathChange]
  );

  const currentRootId = subFolderPath.length > 0 ? subFolderPath[subFolderPath.length - 1].id : undefined;

  return (
    <>
      <RemoteProviderTree
        // Re-key on the root so the underlying useRemoteTree resets cleanly
        // when the user drills in or pops up — avoids carrying expand state
        // from a previous level into the new tree.
        key={currentRootId ?? '__root__'}
        provider={providerId}
        providerName={providerName}
        providerIcon={providerIcon}
        onBack={() => {
          /* parent owns exit via its toolbar back button */
        }}
        showHeader={false}
        rootFolderId={currentRootId}
        onDrillIntoFolder={handleDrillIn}
        onDownloadFile={downloadRemoteFile}
        onEmailView={providerId === 'gmail' ? handleEmailView : undefined}
      />
      <EmailViewerModal
        show={emailViewer !== null}
        onHide={() => setEmailViewer(null)}
        provider={emailViewer?.provider || ''}
        fileId={emailViewer?.fileId || ''}
        fileName={emailViewer?.fileName || ''}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Synergy path — uses `RemoteProviderInlineRows` because the jobs → folders →
// files flow is meaningfully different from the OAuth tree and lives there.
// We pre-enter the Synergy view on mount, then render breadcrumbs + the
// shared file browser in synergy modes.
// ---------------------------------------------------------------------------

function SynergyEmbeddedBrowser({
  subFolderPath,
  onSubFolderPathChange,
}: {
  subFolderPath: SubFolderBreadcrumb[];
  onSubFolderPathChange: (path: SubFolderBreadcrumb[]) => void;
}): React.JSX.Element {
  const { t } = useTranslation('files');

  // Drill-in via double-click on a folder or job row: push the row's
  // identity onto the parent-owned sub-path. RemoteProviderInlineRows is
  // re-keyed on the path so the next render re-roots cleanly (matches the
  // OAuth drill view's `key={currentRootId}` pattern in
  // `OAuthEmbeddedBrowser`).
  const handleDrillIn = useCallback(
    (folder?: { id: string; name: string }) => {
      if (!folder) return;
      onSubFolderPathChange([...subFolderPath, { id: folder.id, name: folder.name }]);
    },
    [subFolderPath, onSubFolderPathChange]
  );

  // In-job file search. Synergy file search is job-scoped, so the search box is
  // only offered once the user is inside a job (subFolderPath[0]). Searching
  // covers the whole job (name + contents) regardless of how deep the user has
  // drilled. The query is reset whenever the job scope changes so it never
  // leaks across jobs.
  // Search is part of SYNERGY_FILE_PARITY — hidden entirely when the flag is off.
  const parityEnabled = getFlag('SYNERGY_FILE_PARITY');
  const insideJob = parityEnabled && subFolderPath.length > 0;
  const jobScopeId = insideJob ? subFolderPath[0].id : null;
  const jobName = insideJob ? subFolderPath[0].name : '';
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  useEffect(() => {
    setSearchInput('');
    setActiveQuery('');
  }, [jobScopeId]);
  const runSearch = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      setActiveQuery(searchInput.trim());
    },
    [searchInput]
  );
  const clearSearch = useCallback(() => {
    setSearchInput('');
    setActiveQuery('');
  }, []);

  const rootKey = subFolderPath.map((p) => p.id).join('/') || '__root__';
  // The drill view delegates all of its rendering + state to the shared
  // `RemoteProviderInlineRows` component so chevron-expand, per-folder
  // Load more, and per-file download all behave identically to the User
  // Files inline expansion. The page toolbar's back button drives a
  // shorter `subFolderPath`, which re-keys this component and re-roots
  // the tree one level up.

  return (
    <div className="finder-files">
      {/* In-job file search (name + contents). Only shown once inside a job,
          because Synergy file search is job-scoped — there is no global search.
          Searching covers the whole job regardless of drill depth. */}
      {insideJob && (
        <Form onSubmit={runSearch} className="px-2 py-2 border-bottom">
          <InputGroup size="sm">
            <Form.Control
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('synergy.searchPlaceholder', 'Search files in {{job}} by name or contents', {
                job: jobName,
              })}
              aria-label={t('synergy.searchAria', 'Search files in this job')}
            />
            {activeQuery && (
              <Button
                variant="outline-secondary"
                onClick={clearSearch}
                title={t('synergy.clearSearch', 'Clear search')}
                aria-label={t('synergy.clearSearch', 'Clear search')}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </Button>
            )}
            <Button variant="primary" type="submit" disabled={!searchInput.trim()}>
              <i className="bi bi-search me-1" aria-hidden="true" />
              {t('synergy.searchButton', 'Search')}
            </Button>
          </InputGroup>
        </Form>
      )}
      {/* Render the Synergy tree using the SAME inline-rows component the
          User Files surface uses — chevron-expandable jobs → folders →
          subfolders + files, with per-row Load more and download buttons.
          The drill view's expansion behaviour matches the
          User Files dropdown exactly. When a search is active the same
          component renders the flat job-scoped results instead of the tree. */}
      <div className="finder-list">
        <RemoteProviderInlineRows
          key={rootKey}
          providerId={SYNERGY_PROVIDER_ID}
          baseDepth={0}
          rootSubFolderPath={subFolderPath}
          onFolderDoubleClick={handleDrillIn}
          searchQuery={activeQuery}
        />
      </div>
    </div>
  );
}
