import React, { useMemo } from 'react';
import * as Papa from 'papaparse';
import { useTranslation } from 'react-i18next';

interface CsvPreviewProps {
  csvContent: string;
}

/**
 * CSV Preview Table Component
 * Parses and displays CSV content in a scrollable table
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
      <div className="table-responsive" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <table className="table table-sm table-bordered table-hover">
          <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              {headers.map((header, idx) => (
                <th key={idx}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    style={{
                      whiteSpace: 'pre-wrap',
                      maxWidth: '300px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
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
        <div className="text-muted small mt-2" style={{ flexShrink: 0 }}>
          <i className="bi bi-info-circle me-1"></i>
          {t('filePreview.csv.rowsShowing', { total: totalRows })}
        </div>
      )}
    </div>
  );
};
