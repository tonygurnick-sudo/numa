import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { Button, Form, Collapse } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useJobsApi } from '../../Services/jobsApi';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { useAuth } from '../../Providers/AuthProvider';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import axios from 'axios';
import { withPRM } from '../../utils/prmUtils';

// Types for the Agentic Backend Response
type AgentIteration = {
  step: number;
  parsed?: {
    thought?: string;
    sql?: string;
    final_answer?: string;
  };
  result?: unknown[];
  error?: string;
  llm_raw?: string;
  final_answer?: string;
};

type AskResponse = {
  status?: string;
  answer?: string;
  question?: string;

  // Top-level SQL/data (now returned by /investigate too)
  sql?: string;
  data?: unknown[];

  // Optional debug iterations
  iterations?: AgentIteration[];

  error?: string;
  details?: string;

  // If client receives Lambda proxy response directly
  statusCode?: number;
  body?: string;
};

// Message types for the conversation
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  data?: unknown[];
  error?: string;
  timestamp: Date;

  // Optional debug payload (kept out of the main content)
  debug?: {
    iterations?: AgentIteration[];
    raw?: unknown;
  };
};

// Uploaded file info
type UploadedFile = {
  name: string;
  s3Key: string;
  bucket: string;
};

// --- HELPER: Sanitize data for Backend ---
// Recursively converts numbers to strings to prevent "Decimal not JSON serializable"
// errors when the generic Jobs API backend processes the payload.
const sanitizeForBackend = (data: unknown): unknown => {
  if (data === null || data === undefined) return data;
  if (typeof data === 'number') return String(data);
  if (Array.isArray(data)) return data.map(sanitizeForBackend);
  if (typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, sanitizeForBackend(v)])
    );
  }
  return data;
};

function isDebugEnabled(): boolean {
  // Opt-in only: add ?debug=1 to the URL
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === '1';
  } catch {
    return false;
  }
}

function unwrapLambdaProxyResponse(maybe: AskResponse): AskResponse {
  // If the response looks like API Gateway proxy format, parse the "body"
  if (maybe && typeof maybe.body === 'string' && typeof maybe.statusCode === 'number') {
    try {
      const parsed = JSON.parse(maybe.body) as AskResponse;
      return parsed;
    } catch (e) {
      // If parsing fails, return a structured error-ish response
      return {
        status: 'error',
        error: 'Invalid proxy body JSON',
        details: (e as Error)?.message ?? 'Unknown parse error',
        answer: 'No response received',
      };
    }
  }
  return maybe;
}

/**
 * Best-effort parsing for agent outputs that might be:
 *  - plain text
 *  - JSON object string
 *  - JSON array string
 *  - multiple JSON objects separated by commas (not wrapped in [])
 *  - fenced ```json blocks
 */
function tryParseJsonLoose(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Prefer fenced JSON blocks if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const candidate = (fenceMatch?.[1] ?? trimmed).trim();

  // 1) Straight JSON
  try {
    return JSON.parse(candidate);
  } catch {
    // continue
  }

  // 2) Common case: "{...}, {...}, {...}" (not wrapped)
  if (candidate.startsWith('{') && candidate.includes('},')) {
    try {
      return JSON.parse(`[${candidate}]`);
    } catch {
      // continue
    }
  }

  // 3) Extract 1+ JSON values via lightweight brace matching (object/array)
  const firstStart = candidate.search(/[{[]/);
  if (firstStart === -1) return null;

  const substr = candidate.slice(firstStart);
  const extracted: string[] = [];
  let i = 0;

  while (i < substr.length) {
    // skip whitespace / commas between values
    while (i < substr.length && /[\s,]/.test(substr[i])) i++;
    if (i >= substr.length) break;

    const c = substr[i];
    if (c !== '{' && c !== '[') break;

    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;

    for (; i < substr.length; i++) {
      const ch = substr[i];

      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;

      if (depth === 0) {
        const jsonChunk = substr.slice(start, i + 1);
        extracted.push(jsonChunk);
        i = i + 1;
        break;
      }
    }

    // If we never closed properly, stop
    if (depth !== 0) break;
  }

  if (extracted.length === 0) return null;

  if (extracted.length > 1) {
    try {
      return extracted.map((s) => JSON.parse(s));
    } catch {
      // fall back to first
    }
  }

  try {
    return JSON.parse(extracted[0]);
  } catch {
    return null;
  }
}

function pickFinalAnswerFromParsed(parsed: unknown): { answer?: string; sql?: string } {
  if (!parsed) return {};

  // Array: pick the last element with final_answer
  if (Array.isArray(parsed)) {
    for (let i = parsed.length - 1; i >= 0; i--) {
      const item = parsed[i];
      if (typeof item === 'string') {
        const ans = item;
        if (ans.trim()) return { answer: ans };
        continue;
      }
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const ans =
          (typeof obj.final_answer === 'string' && obj.final_answer) ||
          (typeof (obj.parsed as Record<string, unknown> | undefined)?.final_answer === 'string' &&
            (obj.parsed as Record<string, unknown>).final_answer) ||
          (typeof obj.answer === 'string' && obj.answer) ||
          (typeof obj.content === 'string' && obj.content) ||
          (typeof obj.message === 'string' && obj.message);
        const sql =
          typeof obj.sql === 'string'
            ? obj.sql
            : typeof (obj.parsed as Record<string, unknown> | undefined)?.sql === 'string'
              ? (obj.parsed as Record<string, unknown>).sql
              : undefined;
        if (ans && ans.trim()) return { answer: ans, sql };
      }
    }
    return {};
  }

  // Object: look for typical fields
  if (typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const ans =
      (typeof obj.final_answer === 'string' && obj.final_answer) ||
      (typeof (obj.parsed as Record<string, unknown> | undefined)?.final_answer === 'string' &&
        (obj.parsed as Record<string, unknown>).final_answer) ||
      (typeof obj.answer === 'string' && obj.answer) ||
      (typeof obj.content === 'string' && obj.content) ||
      (typeof obj.message === 'string' && obj.message);
    const sql =
      typeof obj.sql === 'string'
        ? obj.sql
        : typeof (obj.parsed as Record<string, unknown> | undefined)?.sql === 'string'
          ? (obj.parsed as Record<string, unknown>).sql
          : undefined;
    if (typeof ans === 'string' && ans.trim()) return { answer: ans, sql };
    return {};
  }

  if (typeof parsed === 'string') return { answer: parsed };
  return {};
}

function pickFinalAnswerFromIterations(iterations?: AgentIteration[]): {
  answer?: string;
  sql?: string;
  data?: unknown[];
} {
  if (!iterations || iterations.length === 0) return {};

  // Prefer last iteration that has a final answer
  for (let i = iterations.length - 1; i >= 0; i--) {
    const it = iterations[i];
    const ans = it.final_answer ?? it.parsed?.final_answer;
    const sql = it.parsed?.sql;
    const data = it.result;
    if (typeof ans === 'string' && ans.trim()) return { answer: ans, sql, data };
  }

  // Otherwise maybe last SQL/data step
  for (let i = iterations.length - 1; i >= 0; i--) {
    const it = iterations[i];
    if (it.parsed?.sql) return { sql: it.parsed.sql };
  }
  for (let i = iterations.length - 1; i >= 0; i--) {
    const it = iterations[i];
    if (Array.isArray(it.result) && it.result.length > 0) return { data: it.result };
  }

  return {};
}

function normalizeAskResponse(raw: AskResponse): {
  ok: boolean;
  answer: string;
  sql?: string;
  data?: unknown[];
  iterations?: AgentIteration[];
  error?: string;
  details?: string;
  raw?: unknown;
} {
  const unwrapped = unwrapLambdaProxyResponse(raw);
  const iterations = unwrapped.iterations;

  // Error path
  if (unwrapped.error) {
    return {
      ok: false,
      answer: unwrapped.details || unwrapped.error || 'Request failed',
      error: unwrapped.error,
      details: unwrapped.details,
      sql: unwrapped.sql,
      data: unwrapped.data,
      iterations,
      // keep both raw and unwrapped for useful debugging
      raw: { raw, unwrapped },
    };
  }

  const fromIters = pickFinalAnswerFromIterations(iterations);

  let answer = unwrapped.answer ?? '';
  let sql = unwrapped.sql;
  let data = unwrapped.data;

  // If answer looks like JSON-ish, parse and prefer final_answer
  if (typeof answer === 'string') {
    const looksJson =
      /^\s*[{[]/.test(answer) ||
      answer.includes('"final_answer"') ||
      answer.includes('"thought"') ||
      answer.includes('"sql"');

    if (looksJson) {
      const parsed = tryParseJsonLoose(answer);
      const picked = pickFinalAnswerFromParsed(parsed);
      if (picked.answer) answer = picked.answer;
      if (!sql && picked.sql) sql = picked.sql;
    }
  } else {
    try {
      answer = JSON.stringify(answer);
    } catch {
      answer = '';
    }
  }

  // If still empty, try from iterations
  if (!answer || !answer.trim()) {
    if (fromIters.answer) answer = fromIters.answer;
  }

  // Backfill sql/data from iterations if missing
  if (!sql && fromIters.sql) sql = fromIters.sql;
  if (!data && fromIters.data) data = fromIters.data;

  if (!answer || !answer.trim()) {
    answer = 'I was unable to generate an answer for your question.';
  }

  return {
    ok: true,
    answer,
    sql,
    data,
    iterations,
    // keep both raw and unwrapped for useful debugging
    raw: { raw, unwrapped },
  };
}

export const StructuredDataQueryDetail = () => {
  // Config state
  const [bucketName, setBucketName] = useState<string>('');
  const [region, setRegion] = useState<string>('');

  // Upload state
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Conversation state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedSql, setExpandedSql] = useState<Set<string>>(new Set());
  const [expandedDebug, setExpandedDebug] = useState<Set<string>>(new Set());

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Hooks
  const { t } = useTranslation('apps');
  const { numaPost } = useNumaRequest();
  const { getCredentials, user } = useAuth();
  const jobsApi = useJobsApi();
  const { numaAppData, setError, currentJobId, setCurrentJobId, runName, isJobNamingEnabled } = useNumaApp();

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await fetch('/config.json', { cache: 'no-store' });
        if (res.ok) {
          const cfg = await res.json();
          const bucket =
            cfg.OUTPUT_BUCKET || cfg.OUTPUTS_BUCKET_NAME || (cfg.CLIENT_NAME ? `numa-${cfg.CLIENT_NAME}-outputs` : '');
          const cfgRegion = cfg.REGION || 'ap-southeast-2';
          setBucketName(bucket);
          setRegion(cfgRegion);
        }
      } catch (e) {
        console.error('Failed to load config:', e);
        setUploadError('Failed to load configuration');
      }
    };
    loadConfig();
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle file upload
  const handleUpload = useCallback(
    async (file: File) => {
      if (!bucketName || !region) {
        setUploadError('Configuration not loaded. Please refresh the page.');
        return;
      }

      // Validate file type
      if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
        setUploadError('Please upload a CSV file');
        return;
      }

      setIsUploading(true);
      setUploadError(null);

      try {
        const credentials = await getCredentials();
        const userSub =
          (user as { decoded_tokens?: { idToken?: { sub?: string } } })?.decoded_tokens?.idToken?.sub || 'anonymous';

        // Generate S3 key
        const randomId = Math.random().toString(36).slice(2);
        const timestamp = Date.now();
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const s3Key = `structured-data-query/${userSub}/${timestamp}_${randomId}_${sanitizedName}`;

        // Create S3 client with PRM
        const s3Client = withPRM(S3Client, {
          region,
          credentials,
        });

        // Get presigned URL
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
          ContentType: 'text/csv',
        });
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        // Upload file
        await axios.put(presignedUrl, file, {
          headers: { 'Content-Type': 'text/csv' },
        });

        // Success
        setUploadedFile({
          name: file.name,
          s3Key,
          bucket: bucketName,
        });

        if (numaAppData) {
          try {
            const fileInput = {
              id: crypto.randomUUID(),
              name: file.name,
              s3_key: s3Key,
              s3Bucket: bucketName,
            };
            const inputs = {
              'upload-file': [fileInput],
            };
            const options = isJobNamingEnabled && runName ? { name: runName } : undefined;
            const jobResponse = await jobsApi.createJob(numaAppData, inputs, 'files-uploaded', options);
            setCurrentJobId(jobResponse.jobId);
          } catch (jobError) {
            console.error('Failed to create job for upload:', jobError);
          }
        }

        // Add welcome message
        setMessages([
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `I've loaded your file "${file.name}". You can now ask questions about your data in natural language. For example:\n\n• "What are the total sales by region?"\n• "Show me the top 5 rows"\n• "What's the average value in each column?"`,
            timestamp: new Date(),
          },
        ]);
      } catch (error) {
        console.error('Upload error:', error);
        setError(error instanceof Error ? error.message : 'Failed to upload file');
        setUploadError(error instanceof Error ? error.message : 'Failed to upload file');
      } finally {
        setIsUploading(false);
      }
    },
    [
      bucketName,
      region,
      getCredentials,
      user,
      jobsApi,
      numaAppData,
      setCurrentJobId,
      runName,
      isJobNamingEnabled,
      setError,
    ]
  );

  // Handle file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUpload(file);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleUpload(file);
    }
  };

  // Handle uploading a new file
  const handleUploadNew = () => {
    setUploadedFile(null);
    setMessages([]);
    setInputValue('');
    setUploadError(null);
    setCurrentJobId(null);
  };

  // Toggle SQL expansion
  const toggleSqlExpanded = (messageId: string) => {
    setExpandedSql((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  // Toggle Debug expansion
  const toggleDebugExpanded = (messageId: string) => {
    setExpandedDebug((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  // Send a question to the API
  const handleSendMessage = async () => {
    const question = inputValue.trim();
    if (!question || !uploadedFile || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const s3Path = `s3://${uploadedFile.bucket}/${uploadedFile.s3Key}`;

      let jobId = currentJobId;
      if (numaAppData) {
        const options = isJobNamingEnabled && runName ? { name: runName } : undefined;
        const inputs = {
          'upload-file': [
            {
              id: crypto.randomUUID(),
              name: uploadedFile.name,
              s3_key: uploadedFile.s3Key,
              s3Bucket: uploadedFile.bucket,
            },
          ],
        };

        if (!jobId) {
          try {
            const jobResponse = await jobsApi.createJob(numaAppData, inputs, 'PROCESSING', options);
            jobId = jobResponse.jobId;
            setCurrentJobId(jobId);
          } catch (jobError) {
            console.error('Failed to create job for run:', jobError);
          }
        } else {
          try {
            await jobsApi.updateJob(numaAppData, jobId, null, inputs, 'PROCESSING', options);
          } catch (jobError) {
            console.error('Failed to update job status:', jobError);
          }
        }
      }

      const debug = isDebugEnabled();

      // Call the API
      console.log('🚀 SENDING REQUEST:', {
        endpoint: '/api/structured-data-query/investigate',
        question,
        s3Path,
        jobId,
        debug,
      });

      const raw = (await numaPost('/api/structured-data-query/investigate', {
        question,
        s3_path: s3Path,
        jobId,
        debug, // opt-in only
      })) as AskResponse;

      console.log('🔍 RAW RESPONSE:', JSON.stringify(raw, null, 2));

      const normalized = normalizeAskResponse(raw);

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: normalized.answer,
        timestamp: new Date(),
      };

      if (normalized.sql) assistantMessage.sql = normalized.sql;
      if (normalized.data) assistantMessage.data = normalized.data;

      if (!normalized.ok) assistantMessage.error = normalized.error || 'Request failed';

      // Keep debug separate from main content
      if (debug) {
        assistantMessage.debug = {
          iterations: normalized.iterations,
          raw: normalized.raw,
        };
      }

      setMessages((prev) => [...prev, assistantMessage]);

      if (numaAppData && jobId) {
        try {
          // Only send/store iterations when debug is enabled
          const results = {
            answer: normalized.answer,
            sql: assistantMessage.sql,
            data: sanitizeForBackend(assistantMessage.data),
            ...(debug ? { iterations: sanitizeForBackend(normalized.iterations) } : {}),
          };

          const options = isJobNamingEnabled && runName ? { name: runName } : undefined;
          await jobsApi.updateJob(numaAppData, jobId, results, null, normalized.ok ? 'SUCCESS' : 'FAILURE', options);
        } catch (jobError) {
          console.error('Failed to mark job success:', jobError);
        }
      }
    } catch (error) {
      console.error('❌ REQUEST ERROR:', error);

      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error instanceof Error ? error.message : 'An error occurred while processing your question',
        error: 'Request failed',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);

      if (numaAppData && currentJobId) {
        try {
          const options = isJobNamingEnabled && runName ? { name: runName } : undefined;
          await jobsApi.updateJob(numaAppData, currentJobId, { error: errorMessage.content }, null, 'FAILURE', options);
        } catch (jobError) {
          console.error('Failed to mark job failure:', jobError);
        }
      }
      setError(errorMessage.content);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  // Handle Enter key (submit on Enter, newline on Shift+Enter)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Render data as a table
  const renderDataTable = (data: unknown[]) => {
    if (!Array.isArray(data) || data.length === 0) return null;

    const firstRow = data[0];
    if (typeof firstRow !== 'object' || firstRow === null) return null;

    const columns = Object.keys(firstRow as Record<string, unknown>);
    const displayData = data.slice(0, 100);
    const hasMore = data.length > 100;

    return (
      <div className="table-responsive mt-2">
        <table className="table table-sm table-striped table-bordered align-middle">
          <thead className="table-light">
            <tr>
              {columns.map((col) => (
                <th key={col} className="text-nowrap small fw-bold">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayData.map((row, idx) => (
              <tr key={idx}>
                {columns.map((col) => (
                  <td key={col} className="small text-truncate" style={{ maxWidth: '200px' }}>
                    {String((row as Record<string, unknown>)[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && (
          <p className="text-muted small fst-italic">
            {t('structuredDataQuery.table.showingFirstRows', {
              shown: displayData.length,
              total: data.length,
            })}
          </p>
        )}
      </div>
    );
  };

  // Render a message
  const renderMessage = (message: Message) => {
    const isUser = message.role === 'user';
    const isSqlExpanded = expandedSql.has(message.id);
    const isDebugOpen = expandedDebug.has(message.id);
    const messageClass = message.error ? 'message system error' : `message ${message.role}`;
    const messageLabel = message.error ? 'Error:' : isUser ? 'You:' : 'Assistant:';

    const hasDebug = !!message.debug && (!!message.debug.iterations || !!message.debug.raw);

    const toggleStyle: CSSProperties = {
      fontSize: '0.85rem',
      // Force visible link color even if parent backgrounds/styles are funky
      color: 'var(--bs-primary)',
    };

    const toggleStyleMuted: CSSProperties = {
      fontSize: '0.85rem',
      color: 'var(--bs-secondary)',
    };

    return (
      <div key={message.id} className={messageClass}>
        <strong className="message-role d-block mb-1">{messageLabel}</strong>
        <div className="message-content">
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>

          {message.sql && (
            <div className="mt-2">
              <button
                type="button"
                className="btn btn-link btn-sm p-0 text-decoration-none fw-bold show-toggle structured-data-query-sql-toggle"
                onClick={() => toggleSqlExpanded(message.id)}
                style={toggleStyle}
              >
                <i className={`bi bi-${isSqlExpanded ? 'chevron-down' : 'chevron-right'} me-1`}></i>
                {isSqlExpanded ? 'Hide SQL Query' : 'Show SQL Query'}
              </button>
              <Collapse in={isSqlExpanded}>
                <div>
                  <div
                    className="structured-data-query-sql-block p-3 rounded mt-2 font-monospace small"
                    style={{ backgroundColor: '#212529', color: '#ffffff' }}
                  >
                    <pre className="mb-0" style={{ whiteSpace: 'pre-wrap', color: '#ffffff' }}>
                      <code>{message.sql}</code>
                    </pre>
                  </div>
                </div>
              </Collapse>
            </div>
          )}

          {message.data && renderDataTable(message.data)}

          {hasDebug && (
            <div className="mt-2">
              <button
                type="button"
                className="btn btn-link btn-sm p-0 text-decoration-none fw-bold"
                onClick={() => toggleDebugExpanded(message.id)}
                style={toggleStyleMuted}
              >
                <i className={`bi bi-${isDebugOpen ? 'chevron-down' : 'chevron-right'} me-1`}></i>
                {isDebugOpen ? 'Hide Debug' : 'Show Debug'}
              </button>
              <Collapse in={isDebugOpen}>
                <div>
                  <div className="p-3 rounded mt-2 small bg-white border">
                    <div className="fw-bold mb-2">{t('structuredDataQuery.debug.payloadTitle')}</div>
                    <pre className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(
                        {
                          iterations: message.debug?.iterations,
                          raw: message.debug?.raw,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </div>
              </Collapse>
            </div>
          )}

          <div className="structured-data-query-timestamp text-muted small mt-1 text-end">
            {message.timestamp.toLocaleTimeString()}
          </div>
        </div>
      </div>
    );
  };

  // File upload phase
  if (!uploadedFile) {
    return (
      <div className="container py-4">
        <div className="row justify-content-center">
          <div className="col-lg-8">
            <div className="text-center mb-4">
              <h4>{t('structuredDataQuery.intro.title')}</h4>
              <p className="text-muted">{t('structuredDataQuery.intro.description')}</p>
              <p className="text-muted small mb-0">
                {t('structuredDataQuery.intro.debugTipPrefix')}{' '}
                <code>{t('structuredDataQuery.intro.debugQueryParam')}</code>{' '}
                {t('structuredDataQuery.intro.debugTipSuffix')}
              </p>
            </div>

            <div
              className={`upload-container bg-light p-5 rounded-3 border border-2 ${
                isDragging ? 'border-primary bg-primary-subtle' : 'border-dashed'
              }`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{ cursor: 'pointer', borderStyle: 'dashed' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="text-center">
                {isUploading ? (
                  <>
                    <div className="spinner-border text-primary mb-2" role="status">
                      <span className="visually-hidden">Uploading...</span>
                    </div>
                    <p className="mb-0">Uploading file...</p>
                  </>
                ) : (
                  <>
                    <i className="bi bi-cloud-arrow-up text-primary mb-3" style={{ fontSize: '3rem' }}></i>
                    <h5 className="mb-2">{t('structuredDataQuery.upload.dragDropTitle')}</h5>
                    <p className="text-muted small mb-3">{t('structuredDataQuery.upload.dragDropSubtitle')}</p>
                    <Button
                      variant="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      {t('structuredDataQuery.upload.selectFile')}
                    </Button>
                  </>
                )}

                {uploadError && (
                  <div className="alert alert-danger mt-3 mb-0" role="alert">
                    <i className="bi bi-exclamation-circle me-2"></i>
                    {uploadError}
                  </div>
                )}
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv,text/csv"
                style={{ display: 'none' }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Conversation phase
  return (
    <div className="structured-data-query container-fluid h-100 d-flex flex-column p-0" style={{ maxHeight: '100vh' }}>
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between px-4 py-3 border-bottom bg-white">
        <div className="d-flex align-items-center">
          <div className="bg-success-subtle text-success p-2 rounded me-3">
            <i className="bi bi-file-earmark-spreadsheet fs-5"></i>
          </div>
          <div>
            <div className="fw-bold">{uploadedFile.name}</div>
            <div className="small text-muted">{t('structuredDataQuery.header.ready')}</div>
          </div>
        </div>
        <Button variant="outline-secondary" size="sm" onClick={handleUploadNew}>
          <i className="bi bi-arrow-repeat me-1"></i>
          {t('structuredDataQuery.header.newSession')}
        </Button>
      </div>

      {/* Messages */}
      <div
        className="chat-messages structured-data-query-messages flex-grow-1 overflow-auto p-4 bg-light"
        style={{ minHeight: 0 }}
      >
        {messages.map(renderMessage)}
        {isLoading && (
          <div className="d-flex justify-content-start mb-3">
            <div className="bg-white p-3 rounded-3 shadow-sm border">
              <div className="d-flex align-items-center">
                <div className="spinner-border spinner-border-sm text-primary me-2" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                <span className="text-muted">Analyzing your data & running queries...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-top bg-white p-3">
        <div className="container-fluid">
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
          >
            <div className="position-relative">
              <Form.Control
                as="textarea"
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question about your data (e.g., 'What are the top 5 sales regions?')"
                rows={2}
                disabled={isLoading}
                className="form-control shadow-sm pe-5"
                style={{ resize: 'none', borderRadius: '1rem' }}
              />
              <Button
                variant="primary"
                type="submit"
                className="position-absolute end-0 bottom-0 m-2 rounded-circle d-flex align-items-center justify-content-center"
                style={{ width: '32px', height: '32px' }}
                disabled={!inputValue.trim() || isLoading}
              >
                {isLoading ? (
                  <span
                    className="spinner-border spinner-border-sm"
                    role="status"
                    style={{ width: '0.8rem', height: '0.8rem' }}
                  />
                ) : (
                  <i className="bi bi-arrow-up"></i>
                )}
              </Button>
            </div>
            <div className="text-center mt-2">
              <small className="text-muted" style={{ fontSize: '0.75rem' }}>
                {t('structuredDataQuery.disclaimer')}
              </small>
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
};
