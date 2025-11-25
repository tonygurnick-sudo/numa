import { useEffect, useState } from 'react';
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
    return (
      <span className="version" title={`Failed to load version: ${error}`}>
        version unavailable
      </span>
    );
  }

  if (!versionInfo) {
    return (
      <span className="version" title="Loading version information">
        loading...
      </span>
    );
  }

  const hashFromVersion = versionInfo.version?.split('-')?.[0] ?? '';
  const shortHash = versionInfo.gitHash?.slice(0, 7) || hashFromVersion.slice(0, 7) || versionInfo.version;
  const display = MANUAL_VERSION_LABEL || versionInfo.displayVersion || shortHash;
  const titleParts = [
    versionInfo.gitBranch ? `Branch: ${versionInfo.gitBranch}` : null,
    versionInfo.gitHash ? `Commit: ${versionInfo.gitHash}` : null,
    versionInfo.deployTimeHuman ? `Deployed: ${versionInfo.deployTimeHuman}` : null,
    versionInfo.version ? `Version: ${versionInfo.version}` : null,
  ].filter(Boolean);

  return (
    <span className="version" title={titleParts.join('\n')} data-testid="version-display">
      {display}
    </span>
  );
};
