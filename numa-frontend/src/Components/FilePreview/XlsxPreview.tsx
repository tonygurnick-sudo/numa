import React, { useState, useEffect } from 'react';
import { Spinner, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface XlsxPreviewProps {
  data: ArrayBuffer;
  filename?: string;
}

/**
 * XLSX Preview Component using SheetJS
 * Displays spreadsheets with multiple sheet tabs
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
          // Convert to array of arrays, with formatting info where available
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
  const displayRows = currentSheet.data.slice(0, 100);
  const totalRows = currentSheet.data.length;

  return (
    <div className="workspace-xlsx-preview" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="xlsx-sheet-tabs d-flex gap-1 p-2 border-bottom bg-light" style={{ flexShrink: 0 }}>
          {sheets.map((sheet, idx) => (
            <Button
              key={sheet.name}
              size="sm"
              variant={idx === activeSheet ? 'primary' : 'outline-secondary'}
              onClick={() => setActiveSheet(idx)}
              className="px-3"
            >
              {sheet.name}
            </Button>
          ))}
        </div>
      )}

      {/* Data table */}
      <div className="table-responsive" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <table className="table table-sm table-bordered table-hover xlsx-table">
          <tbody>
            {displayRows.map((row, rowIdx) => (
              <tr key={rowIdx} className={rowIdx === 0 ? 'table-light fw-semibold' : ''}>
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
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalRows > 100 && (
        <div className="text-muted small p-2 border-top" style={{ flexShrink: 0 }}>
          <i className="bi bi-info-circle me-1"></i>
          {t('filePreview.xlsx.rowsShowing', { total: totalRows })}
        </div>
      )}
    </div>
  );
};
