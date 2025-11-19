import { useEffect, useState } from 'react';

type VersionInfo = {
  version: string;
  gitHash: string;
  gitBranch: string;
  deployTime: number;
  deployTimeHuman: string;
};

export const VersionDisplay = () => {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/version.json', { cache: 'no-store' })
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
        loading…
      </span>
    );
  }

  const shortHash = versionInfo.gitHash?.slice(0, 7) || versionInfo.version;
  return (
    <span
      className="version"
      title={`Branch: ${versionInfo.gitBranch}\nCommit: ${versionInfo.gitHash}\nDeployed: ${versionInfo.deployTimeHuman}`}
      data-testid="version-display"
    >
      {shortHash}
    </span>
  );
};
