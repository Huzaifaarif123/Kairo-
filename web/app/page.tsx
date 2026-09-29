import fs from 'node:fs';
import path from 'node:path';

// The dashboard markup is served as-is; public/js/kairo.js drives it, exactly
// like the original dashboard/index.html + app.js.
const markup = fs.readFileSync(path.join(process.cwd(), 'app', 'dashboard.html'), 'utf-8');

export default function Page() {
  return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: markup }} />;
}
