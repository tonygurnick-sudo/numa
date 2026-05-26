/**
 * Embedded single-provider browser used by User Files when the user clicks
 * into an integration "folder". Replaces the standalone Remote tab as the
 * surface where integration contents live.
 *
 * Why a wrapper: OAuth providers use the self-contained `RemoteProviderTree`
 * (inline expansion, its own state via `useRemoteTree`), but Synergy is PAT-
 * backed and uses a fundamentally different jobs → folders → files flow that
 * lives in `useRemoteBrowse`. This component picks the right inner experience
 * by provider id so the parent surface stays oblivious.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../Providers/ToastContext';
import { ConnectorsService } from '../../../Services/ConnectorsService';
import { extractApiError } from '../../../utils/extractApiError';
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
// Synergy path — uses `useRemoteBrowse` because the jobs → folders → files
// flow is meaningfully different from the OAuth tree and lives there already.
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
  const rootKey = subFolderPath.map((p) => p.id).join('/') || '__root__';
  // The drill view delegates all of its rendering + state to the shared
  // `RemoteProviderInlineRows` component so chevron-expand, per-folder
  // Load more, and per-file download all behave identically to the User
  // Files inline expansion. The page toolbar's back button drives a
  // shorter `subFolderPath`, which re-keys this component and re-roots
  // the tree one level up.

  return (
    <div className="finder-files">
      {/* Render the Synergy tree using the SAME inline-rows component the
          User Files surface uses — chevron-expandable jobs → folders →
          subfolders + files, with per-row Load more and download buttons.
          This replaces the old flat click-to-drill `RemoteFileBrowser`
          rendering so the drill view's expansion behaviour matches the
          User Files dropdown exactly. */}
      <div className="finder-list">
        <RemoteProviderInlineRows
          key={rootKey}
          providerId={SYNERGY_PROVIDER_ID}
          baseDepth={0}
          rootSubFolderPath={subFolderPath}
          onFolderDoubleClick={handleDrillIn}
        />
      </div>
    </div>
  );
}
