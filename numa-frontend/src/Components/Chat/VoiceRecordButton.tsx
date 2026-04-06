/* eslint-disable react-refresh/only-export-components */
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Button, Modal, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { Mic, MicOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type VoiceRecordingState = 'idle' | 'recording' | 'uploading' | 'error';

interface VoiceRecordButtonProps {
  /** Called with the recorded audio blob and suggested filename when recording stops */
  onRecordingComplete: (blob: Blob, filename: string) => void;
  /** Whether controls should be disabled (streaming, uploading, etc.) */
  disabled?: boolean;
  /** Whether the button is for v2 inline layout */
  isV2Inline?: boolean;
  /** Whether on mobile viewport */
  isMobile?: boolean;
  /** External recording state override (e.g., for showing uploading state) */
  externalState?: VoiceRecordingState;
  /** Render as a primary button matching the send button style (replaces send when input is empty) */
  asSendButton?: boolean;
  /** Size for the send-button variant (e.g., '52px') */
  sendButtonSize?: string;
}

/** Maximum recording duration in seconds (30 minutes) */
const MAX_RECORDING_SECONDS = 1800;

/** Number of bars in the audio visualizer */
const VISUALIZER_BARS = 32;

/**
 * Detect the best supported audio MIME type for MediaRecorder.
 * Prefers Ogg/Opus (natively supported by Transcribe Streaming for future upgrade),
 * falls back to WebM/Opus (Chrome/Firefox default), then MP4 (Safari).
 */
function getPreferredMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;

  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return undefined;
}

/** Map MIME type to file extension */
function getExtension(mimeType: string | undefined): string {
  if (!mimeType) return '.webm';
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return '.m4a';
  return '.webm';
}

/** Check if voice recording is supported in this browser */
export function isVoiceRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

/**
 * Audio visualizer bars that respond to microphone input levels.
 * Uses Web Audio API AnalyserNode for real-time frequency data.
 */
function AudioVisualizer({ stream }: { stream: MediaStream | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.7;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barWidth = (width / VISUALIZER_BARS) * 0.6;
      const gap = (width / VISUALIZER_BARS) * 0.4;
      const step = Math.floor(dataArray.length / VISUALIZER_BARS);

      for (let i = 0; i < VISUALIZER_BARS; i++) {
        // Sample from frequency data, biased toward lower frequencies for voice
        const idx = Math.min(i * step, dataArray.length - 1);
        const value = dataArray[idx] / 255;

        // Minimum bar height so it always looks alive
        const minHeight = 3;
        const barHeight = Math.max(minHeight, value * (height * 0.85));

        const x = i * (barWidth + gap) + gap / 2;
        const y = (height - barHeight) / 2;

        // Gradient from accent color to lighter shade based on intensity
        const intensity = Math.min(1, value * 1.5);
        const r = Math.round(124 + (200 - 124) * (1 - intensity));
        const g = Math.round(58 + (160 - 58) * (1 - intensity));
        const b = Math.round(237 + (255 - 237) * (1 - intensity));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        ctx.fill();
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
      source.disconnect();
      audioContext.close();
    };
  }, [stream]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={80}
      style={{
        width: '100%',
        maxWidth: '320px',
        height: '80px',
      }}
    />
  );
}

export default function VoiceRecordButton({
  onRecordingComplete,
  disabled = false,
  isV2Inline = false,
  isMobile = false,
  externalState,
  asSendButton = false,
  sendButtonSize,
}: VoiceRecordButtonProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<VoiceRecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string | undefined>(undefined);
  const elapsedRef = useRef(0);
  const cancelledRef = useRef(false);

  // externalState only overrides for uploading/error states (not idle/recording which are internal)
  const effectiveState = externalState && externalState !== 'idle' ? externalState : state;

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopMediaTracks();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const stopMediaTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    setErrorMessage('');

    if (!isVoiceRecordingSupported()) {
      setErrorMessage(t('input.voice.error.notSupported'));
      setState('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      const mimeType = getPreferredMimeType();
      mimeTypeRef.current = mimeType;

      const options: MediaRecorderOptions = {};
      if (mimeType) options.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        clearTimer();
        stopMediaTracks();

        if (cancelledRef.current) {
          cancelledRef.current = false;
          chunksRef.current = [];
          setState('idle');
          return;
        }

        const blob = new Blob(chunksRef.current, {
          type: mimeType || recorder.mimeType || 'audio/webm',
        });
        chunksRef.current = [];

        if (blob.size > 0) {
          const ext = getExtension(mimeType || recorder.mimeType);
          const filename = `voice-recording-${Date.now()}${ext}`;
          setState('uploading');
          onRecordingComplete(blob, filename);
        } else {
          setState('idle');
        }
      };

      recorder.onerror = () => {
        clearTimer();
        stopMediaTracks();
        setErrorMessage(t('input.voice.error.recordingFailed'));
        setState('error');
      };

      cancelledRef.current = false;
      recorder.start(1000);
      setState('recording');
      setElapsed(0);
      elapsedRef.current = 0;

      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          const next = prev + 1;
          elapsedRef.current = next;
          if (next >= MAX_RECORDING_SECONDS) {
            if (mediaRecorderRef.current?.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      stopMediaTracks();
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setErrorMessage(t('input.voice.error.micDenied'));
        } else if (err.name === 'NotFoundError') {
          setErrorMessage(t('input.voice.error.noMicrophone'));
        } else {
          setErrorMessage(t('input.voice.error.recordingFailed'));
        }
      } else {
        setErrorMessage(t('input.voice.error.recordingFailed'));
      }
      setState('error');
    }
  }, [t, onRecordingComplete, clearTimer, stopMediaTracks]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    setElapsed(0);
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop(); // onstop handler checks cancelledRef and bails
    } else {
      // Recorder already stopped or never started -- clean up directly
      cancelledRef.current = false;
      clearTimer();
      stopMediaTracks();
      chunksRef.current = [];
      setState('idle');
    }
  }, [clearTimer, stopMediaTracks]);

  const resetState = useCallback(() => {
    setState('idle');
    setErrorMessage('');
    setElapsed(0);
  }, []);

  // Reset internal state when external state explicitly clears (e.g., upload complete)
  useEffect(() => {
    if (externalState === 'idle' && state === 'uploading') {
      setState('idle');
      setElapsed(0);
    }
  }, [externalState, state]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const buttonSize = isMobile ? '30px' : '32px';
  const iconSize = 16;

  const inlineStyle = isV2Inline
    ? {
        position: 'static' as const,
        width: buttonSize,
        height: buttonSize,
        minHeight: buttonSize,
        borderRadius: '8px',
        zIndex: 2,
      }
    : {};

  // Error state: show error icon with tooltip, click to dismiss
  if (effectiveState === 'error') {
    return (
      <OverlayTrigger placement="top" overlay={<Tooltip id="tooltip-voice-error">{errorMessage}</Tooltip>}>
        <span className={`d-inline-block ${isV2Inline ? 'attachment-icon-anchor-v2-inline' : ''}`}>
          <Button
            variant="link"
            className={isV2Inline ? 'attachment-icon v2-inline' : 'attachment-icon'}
            onClick={resetState}
            aria-label={errorMessage}
            style={{
              ...inlineStyle,
              color: 'var(--bs-danger)',
            }}
          >
            <MicOff size={iconSize} strokeWidth={2} />
          </Button>
        </span>
      </OverlayTrigger>
    );
  }

  // Idle / uploading: show mic button + recording modal when active
  const isUploading = effectiveState === 'uploading';
  const tooltipText = isUploading ? t('input.voice.uploading') : t('input.voice.record');

  // Send-button variant: renders as a primary button matching the send button
  const micTrigger = asSendButton ? (
    <OverlayTrigger placement="top" overlay={<Tooltip id="tooltip-voice-record">{tooltipText}</Tooltip>}>
      <Button
        variant="primary"
        type="button"
        className="send-button"
        onClick={startRecording}
        aria-label={t('input.voice.record')}
        disabled={disabled || isUploading}
        style={{
          width: sendButtonSize,
          height: sendButtonSize,
          minWidth: sendButtonSize,
          minHeight: sendButtonSize,
          flex: `0 0 ${sendButtonSize}`,
        }}
      >
        <Mic size={18} strokeWidth={2.1} />
      </Button>
    </OverlayTrigger>
  ) : (
    <OverlayTrigger placement="top" overlay={<Tooltip id="tooltip-voice-record">{tooltipText}</Tooltip>}>
      <span className={`d-inline-block ${isV2Inline ? 'attachment-icon-anchor-v2-inline' : ''}`}>
        <Button
          variant="link"
          className={isV2Inline ? 'attachment-icon v2-inline' : 'attachment-icon'}
          onClick={startRecording}
          aria-label={t('input.voice.record')}
          disabled={disabled || isUploading}
          style={{
            ...inlineStyle,
            ...(disabled || isUploading ? { pointerEvents: 'none' } : {}),
          }}
        >
          <Mic size={iconSize} strokeWidth={2} />
        </Button>
      </span>
    </OverlayTrigger>
  );

  return (
    <>
      {micTrigger}

      {/* Recording / Uploading Modal */}
      <Modal
        show={effectiveState === 'recording' || effectiveState === 'uploading'}
        onHide={effectiveState === 'recording' ? cancelRecording : undefined}
        centered
        size="sm"
        backdrop="static"
        keyboard={effectiveState === 'recording'}
        className="voice-recording-modal"
      >
        <Modal.Body className="text-center py-4 px-4">
          {effectiveState === 'uploading' ? (
            <>
              {/* Uploading state */}
              <div className="d-flex align-items-center justify-content-center gap-2 mb-4">
                <div className="spinner-border spinner-border-sm text-primary" role="status">
                  <span className="visually-hidden">{t('input.voice.sending')}</span>
                </div>
                <span className="text-muted small fw-medium">{t('input.voice.sending')}</span>
              </div>
              <div
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 400,
                  color: 'var(--bs-body-color)',
                }}
              >
                {t('input.voice.recordingLength', { duration: formatTime(elapsed) })}
              </div>
            </>
          ) : (
            <>
              {/* Recording state */}
              <div className="d-flex align-items-center justify-content-center gap-2 mb-3">
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--bs-danger)',
                    animation: 'voicePulse 1.2s ease-in-out infinite',
                    flexShrink: 0,
                  }}
                />
                <span className="text-muted small fw-medium">{t('input.voice.recording')}</span>
              </div>

              {/* Audio visualizer */}
              <div className="d-flex justify-content-center mb-3">
                <AudioVisualizer stream={streamRef.current} />
              </div>

              {/* Countdown timer */}
              <div
                className="mb-4"
                style={{
                  fontSize: '2rem',
                  fontWeight: 300,
                  fontVariantNumeric: 'tabular-nums',
                  color: MAX_RECORDING_SECONDS - elapsed <= 30 ? 'var(--bs-danger)' : 'var(--bs-body-color)',
                  letterSpacing: '0.05em',
                }}
              >
                {formatTime(MAX_RECORDING_SECONDS - elapsed)}
              </div>

              {/* Action buttons */}
              <div className="d-flex align-items-center justify-content-center gap-3">
                <Button
                  variant="outline-secondary"
                  onClick={cancelRecording}
                  className="rounded-circle d-flex align-items-center justify-content-center"
                  style={{ width: '48px', height: '48px' }}
                  aria-label={t('input.voice.cancel')}
                >
                  <X size={20} strokeWidth={2} />
                </Button>

                <Button
                  variant="danger"
                  onClick={stopRecording}
                  className="rounded-circle d-flex align-items-center justify-content-center"
                  style={{
                    width: '64px',
                    height: '64px',
                    boxShadow: '0 4px 12px rgba(220, 53, 69, 0.35)',
                  }}
                  aria-label={t('input.voice.stop')}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </Button>
              </div>

              {/* Max duration hint */}
              {elapsed >= MAX_RECORDING_SECONDS - 10 && (
                <div className="text-danger small mt-3">{t('input.voice.maxDuration')}</div>
              )}
            </>
          )}
        </Modal.Body>
      </Modal>

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes voicePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
    </>
  );
}
