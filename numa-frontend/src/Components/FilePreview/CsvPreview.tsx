import React, { useMemo } from 'react';
import * as Papa from 'papaparse';
import { useTranslation } from 'react-i18next';

interface CsvPreviewProps {
  csvContent: string;
}

const isNumeric = (value: string): boolean => {
  if (!value || value.trim() === '') return false;
  return !isNaN(Number(value.replace(/,/g, '')));
};

/**
 * CSV Preview Table Component
 * Parses and displays CSV content in a styled spreadsheet view
 */
export const CsvPreview: React.FC<CsvPreviewProps> = ({ csvContent }) => {
  const { t } = useTranslation('chat');
  const { headers, rows, totalRows } = useMemo(() => {
    const result = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    if (result.errors.length > 0) {
      console.warn('CSV parsing errors:', result.errors);
    }

    const headers = result.meta.fields || [];
    const totalRows = result.data.length;
    const rows = result.data
      .slice(0, 100)
      .map((row: Record<string, string>) => headers.map((header) => row[header] || ''));

    return { headers, rows, totalRows };
  }, [csvContent]);

  if (headers.length === 0) {
    return <div className="text-muted">{t('filePreview.csv.noData')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
          {totalRows} {totalRows === 1 ? 'row' : 'rows'} &middot; {headers.length}{' '}
          {headers.length === 1 ? 'column' : 'columns'}
        </span>
      </div>

      {/* Table */}
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
              {headers.map((header, idx) => (
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
                    borderRight: idx < headers.length - 1 ? '1px solid rgba(255,255,255,0.2)' : 'none',
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
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
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    style={{
                      padding: '0.5rem 0.75rem',
                      whiteSpace: 'pre-wrap',
                      maxWidth: '300px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      borderRight: cellIdx < row.length - 1 ? '1px solid #f0f0f0' : 'none',
                      textAlign: isNumeric(cell) ? 'right' : 'left',
                      fontVariantNumeric: isNumeric(cell) ? 'tabular-nums' : 'normal',
                    }}
                  >
                    {cell}
                  </td>
                ))}
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
          {t('filePreview.csv.rowsShowing', { total: totalRows })}
        </div>
      )}
    </div>
  );
};
