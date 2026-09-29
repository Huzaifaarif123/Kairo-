// CSV helpers for job_search_tracker.csv (same format as the original dashboard)

export type Row = Record<string, string>;

export const TRACKER_HEADERS = ['date', 'company', 'sector', 'role', 'role_type', 'channel', 'status', 'contact_person', 'fit_rating', 'notes', 'cv_file', 'cover_letter_file', 'source', 'deadline'];

export function parseCSV(csvText: string): Row[] {
  const lines = csvText.trim().split('\n');
  if (lines.length === 0 || (lines.length === 1 && !lines[0].trim())) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows: Row[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV line handling quotes
    const values: string[] = [];
    let insideQuotes = false;
    let currentVal = '';

    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        values.push(currentVal.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    values.push(currentVal.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

    const obj: Row = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] !== undefined ? values[idx] : '';
    });
    rows.push(obj);
  }
  return rows;
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
