import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MANUAL_VERSION_LABEL } from '../utils/versionLabel';

type VersionInfo = {
  version: string;
  gitHash: string;
  gitBranch: string;
  deployTime: number;
  deployTimeHuman: string;
  displayVersion?: string;
};

export const VersionDisplay = () => {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation('common');

  useEffect(() => {
    let cancelled = false;
    fetch('/version.json', { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`version.json HTTP ${res.status}`);
        return res.json();
      })
      .then((data: VersionInfo) => {
        if (!cancelled) {
          setVersionInfo(data);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setVersionInfo(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    // If we have a manual version label, show it even if version.json fails
    if (MANUAL_VERSION_LABEL) {
      return (
        <span className="version" title={t('version.infoUnavailable', { error })}>
          {MANUAL_VERSION_LABEL}
        </span>
      );
    }
    return (
      <span className="version" title={t('version.loadFailed', { error })}>
        {t('version.unavailable')}
      </span>
    );
  }

  if (!versionInfo) {
    return (
      <span className="version" title={t('version.loadingTitle')}>
        {t('version.loadingLabel')}
      </span>
    );
  }

  const hashFromVersion = versionInfo.version?.split('-')?.[0] ?? '';
  const shortHash = versionInfo.gitHash?.slice(0, 7) || hashFromVersion.slice(0, 7) || versionInfo.version;
  const display = MANUAL_VERSION_LABEL || versionInfo.displayVersion || shortHash;
  const titleParts = [
    versionInfo.gitBranch ? t('version.details.branch', { value: versionInfo.gitBranch }) : null,
    versionInfo.gitHash ? t('version.details.commit', { value: versionInfo.gitHash }) : null,
    versionInfo.deployTimeHuman ? t('version.details.deployed', { value: versionInfo.deployTimeHuman }) : null,
    versionInfo.version ? t('version.details.version', { value: versionInfo.version }) : null,
  ].filter(Boolean);

  return (
    <span className="version" title={titleParts.join('\n')} data-testid="version-display">
      {display}
    </span>
  );
};
