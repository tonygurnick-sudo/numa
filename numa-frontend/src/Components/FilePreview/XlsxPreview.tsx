import React, { useState, useEffect } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface XlsxPreviewProps {
  data: ArrayBuffer;
  filename?: string;
}

const isNumeric = (value: string): boolean => {
  if (!value || value.trim() === '') return false;
  return !isNaN(Number(String(value).replace(/,/g, '')));
};

/**
 * XLSX Preview Component using SheetJS
 * Displays spreadsheets with styled sheet tabs and table
 */
export const XlsxPreview: React.FC<XlsxPreviewProps> = ({ data, filename: _filename }) => {
  const { t } = useTranslation('chat');
  const [sheets, setSheets] = useState<{ name: string; data: string[][] }[]>([]);
  const [activeSheet, setActiveSheet] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const parseXlsx = async () => {
      try {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(data, { type: 'array' });

        const parsedSheets = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name];
          const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, {
            header: 1,
            defval: '',
          });
          return { name, data: jsonData as string[][] };
        });

        setSheets(parsedSheets);
        setLoading(false);
      } catch (err) {
        console.error('Error parsing XLSX:', err);
        setError('Failed to parse spreadsheet. The file may be corrupted.');
        setLoading(false);
      }
    };

    parseXlsx();
  }, [data]);

  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" size="sm" />
        <span className="ms-2">{t('page.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3">
        <div className="alert alert-warning mb-0">{error}</div>
      </div>
    );
  }

  if (sheets.length === 0) {
    return <div className="text-muted p-3">{t('filePreview.xlsx.noData')}</div>;
  }

  const currentSheet = sheets[activeSheet];
  const headerRow = currentSheet.data[0] || [];
  const dataRows = currentSheet.data.slice(1, 101);
  const totalRows = currentSheet.data.length - 1; // exclude header
  const maxCols = Math.max(headerRow.length, ...dataRows.map((r) => r.length));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: '0.25rem',
            padding: '0.5rem 0',
            flexShrink: 0,
            borderBottom: '2px solid #e2e8f0',
          }}
        >
          {sheets.map((sheet, idx) => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheet(idx)}
              style={{
                padding: '0.35rem 1rem',
                fontSize: '0.8rem',
                fontWeight: idx === activeSheet ? 600 : 400,
                border: 'none',
                borderBottom: idx === activeSheet ? '2px solid var(--color-primary, #6f42c1)' : '2px solid transparent',
                marginBottom: '-2px',
                backgroundColor: 'transparent',
                color: idx === activeSheet ? 'var(--color-primary, #6f42c1)' : '#6c757d',
                cursor: 'pointer',
                transition: 'all 0.15s',
                borderRadius: '4px 4px 0 0',
              }}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Summary bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.5rem 0',
          flexShrink: 0,
          fontSize: '0.8rem',
          color: '#6c757d',
        }}
      >
        <span>
          <i className="bi bi-grid-3x3 me-1"></i>
          {totalRows} {totalRows === 1 ? 'row' : 'rows'} &middot; {maxCols} {maxCols === 1 ? 'column' : 'columns'}
        </span>
      </div>

      {/* Data table */}
      <div
        className="table-responsive"
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.85rem',
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  backgroundColor: 'var(--color-primary, #6f42c1)',
                  color: 'white',
                  padding: '0.6rem 0.5rem',
                  textAlign: 'center',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  width: '3rem',
                  borderRight: '1px solid rgba(255,255,255,0.2)',
                }}
              >
                #
              </th>
              {headerRow.map((header, idx) => (
                <th
                  key={idx}
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                    backgroundColor: 'var(--color-primary, #6f42c1)',
                    color: 'white',
                    padding: '0.6rem 0.75rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    borderRight: idx < headerRow.length - 1 ? '1px solid rgba(255,255,255,0.2)' : 'none',
                  }}
                >
                  {String(header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                style={{
                  backgroundColor: rowIdx % 2 === 0 ? '#ffffff' : '#f8f9fc',
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eef2ff')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = rowIdx % 2 === 0 ? '#ffffff' : '#f8f9fc')}
              >
                <td
                  style={{
                    padding: '0.5rem',
                    textAlign: 'center',
                    color: '#94a3b8',
                    fontSize: '0.75rem',
                    fontVariantNumeric: 'tabular-nums',
                    borderRight: '1px solid #e2e8f0',
                    backgroundColor: rowIdx % 2 === 0 ? '#fafbfd' : '#f3f4f8',
                    userSelect: 'none',
                  }}
                >
                  {rowIdx + 1}
                </td>
                {headerRow.map((_, cellIdx) => {
                  const cell = String(row[cellIdx] ?? '');
                  return (
                    <td
                      key={cellIdx}
                      style={{
                        padding: '0.5rem 0.75rem',
                        whiteSpace: 'pre-wrap',
                        maxWidth: '300px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        borderRight: cellIdx < headerRow.length - 1 ? '1px solid #f0f0f0' : 'none',
                        textAlign: isNumeric(cell) ? 'right' : 'left',
                        fontVariantNumeric: isNumeric(cell) ? 'tabular-nums' : 'normal',
                      }}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalRows > 100 && (
        <div
          style={{
            flexShrink: 0,
            padding: '0.5rem 0',
            fontSize: '0.8rem',
            color: '#6c757d',
          }}
        >
          <i className="bi bi-info-circle me-1"></i>
          {t('filePreview.xlsx.rowsShowing', { total: totalRows })}
        </div>
      )}
    </div>
  );
};
