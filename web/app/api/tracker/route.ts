import { resolveProfile, getTracker, saveTracker } from '@/lib/profiles';
import type { Row } from '@/lib/csv';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const profile = resolveProfile(new URL(req.url).searchParams.get('profile'));
    return Response.json(await getTracker(profile));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const profile = resolveProfile(new URL(req.url).searchParams.get('profile'));
    const payload = await req.json().catch(() => undefined);
    if (!payload || typeof payload !== 'object') {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    let rows: Row[] = await getTracker(profile);

    if (Array.isArray(payload)) {
      // Replace all rows
      rows = payload;
    } else if (payload.action === 'delete') {
      rows = rows.filter(r => !(r.company === payload.company && r.role === payload.role));
    } else {
      // Update or insert
      const existingIdx = rows.findIndex(r => r.company === payload.company && r.role === payload.role);
      if (existingIdx >= 0) {
        rows[existingIdx] = { ...rows[existingIdx], ...payload };
      } else {
        rows.unshift({
          date: payload.date || new Date().toISOString().split('T')[0],
          company: payload.company || 'Unknown',
          sector: payload.sector || 'Tech',
          role: payload.role || 'Senior Engineer',
          role_type: payload.role_type || 'Full-time',
          channel: payload.channel || 'Direct',
          status: payload.status || 'drafted',
          contact_person: payload.contact_person || '',
          fit_rating: payload.fit_rating || '85',
          notes: payload.notes || '',
          cv_file: payload.cv_file || '',
          cover_letter_file: payload.cover_letter_file || '',
          source: payload.source || '',
          deadline: payload.deadline || ''
        });
      }
    }

    await saveTracker(profile, rows);
    return Response.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
