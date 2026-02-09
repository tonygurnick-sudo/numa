import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface VttCue {
  startTime: string;
  speaker: string;
  text: string;
}

interface VttPreviewProps {
  content: string;
}

/**
 * Parse a VTT timestamp like "00:04:35.639" into a short display format like "4:35"
 */
function formatTimestamp(raw: string): string {
  const match = raw.trim().match(/^(\d+):(\d+):(\d+)/);
  if (!match) return raw.trim();
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Parse WebVTT content into an array of cues with speaker and text separated.
 */
function parseVtt(content: string): VttCue[] {
  const cues: VttCue[] = [];
  // Normalize line endings — S3-fetched files often use \r\n
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // Find the timestamp line (contains "-->")
    const tsIdx = lines.findIndex((l) => l.includes('-->'));
    if (tsIdx === -1) continue;

    const tsParts = lines[tsIdx].split('-->');
    const startTime = formatTimestamp(tsParts[0]);

    // Text lines are everything after the timestamp
    const textLines = lines
      .slice(tsIdx + 1)
      .join(' ')
      .trim();
    if (!textLines) continue;

    // Split "Speaker Name: text" if present
    const colonIdx = textLines.indexOf(':');
    let speaker = '';
    let text = textLines;
    if (colonIdx > 0 && colonIdx < 60) {
      const candidate = textLines.slice(0, colonIdx).trim();
      // Heuristic: speaker names don't contain timestamps or long phrases
      if (candidate.length < 50 && !candidate.includes('-->')) {
        speaker = candidate;
        text = textLines.slice(colonIdx + 1).trim();
      }
    }

    cues.push({ startTime, speaker, text });
  }

  return cues;
}

/**
 * VTT (WebVTT) Preview Component
 * Renders meeting transcripts with speaker names and timestamps in a readable format.
 */
export const VttPreview: React.FC<VttPreviewProps> = ({ content }) => {
  const { t } = useTranslation('chat');

  const cues = useMemo(() => parseVtt(content), [content]);

  if (cues.length === 0) {
    return (
      <div className="p-3">
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</pre>
      </div>
    );
  }

  // Group consecutive cues by speaker for cleaner display
  const grouped: { speaker: string; startTime: string; texts: string[] }[] = [];
  for (const cue of cues) {
    const last = grouped[grouped.length - 1];
    if (last && last.speaker === cue.speaker && cue.speaker) {
      last.texts.push(cue.text);
    } else {
      grouped.push({ speaker: cue.speaker, startTime: cue.startTime, texts: [cue.text] });
    }
  }

  const duration = cues.length > 0 ? cues[cues.length - 1].startTime : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="px-3 py-2 border-bottom bg-light d-flex align-items-center gap-2">
        <i className="bi bi-chat-quote text-muted"></i>
        <span className="text-muted small">{t('filePreview.vtt.summary', { entries: grouped.length, duration })}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }} className="p-3">
        {grouped.map((group, idx) => (
          <div key={idx} className="mb-3">
            <div className="d-flex align-items-baseline gap-2 mb-1">
              {group.speaker && (
                <span className="fw-semibold" style={{ color: 'var(--color-primary)' }}>
                  {group.speaker}
                </span>
              )}
              <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                {group.startTime}
              </span>
            </div>
            <div style={{ paddingLeft: group.speaker ? '0' : '0', lineHeight: '1.6' }}>{group.texts.join(' ')}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
