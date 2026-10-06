// CSV helpers for job_search_tracker.csv (same format as the original dashboard)

export type Row = Record<string, string>;

export const TRACKER_HEADERS = ['date', 'company', 'sector', 'role', 'role_type', 'channel', 'status', 'contact_person', 'fit_rating', 'notes', 'cv_file', 'cover_letter_file', 'source', 'deadline'];

// A proper CSV parser, not a line-splitter: a quoted field (e.g. a note with "Add a
// note:" joining several lines with "\n") can itself contain a real newline, so rows can
// only be split on a newline that isn't inside quotes — splitting the whole text on "\n"
// first (the previous approach) tears a multi-line field into two broken rows.
export function parseCSV(csvText: string): Row[] {
  const text = String(csvText || '').trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text) return [];
  const rows: string[][] = [];
  let row: string[] = [], field = '', insideQuotes = false;
  const pushField = () => { row.push(field.trim()); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (insideQuotes) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else insideQuotes = false; }
      else field += char;
      continue;
    }
    if (char === '"') insideQuotes = true;
    else if (char === ',') pushField();
    else if (char === '\n') pushRow();
    else field += char;
  }
  if (field !== '' || row.length) pushRow();
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter(r => r.some(v => v !== '')).map(values => {
    const obj: Row = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] !== undefined ? values[idx] : ''; });
    return obj;
  });
}

export function stringifyCSV(headers: string[], rows: Row[]): string {
  const headerLine = headers.join(',');
  const rowLines = rows.map(r => {
    return headers.map(h => {
      let val = r[h] !== undefined ? String(r[h]) : '';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',');
  });
  return [headerLine, ...rowLines].join('\n') + '\n';
}
