import { resolveProfile, profileDetails, saveProfileMarkdown } from '@/lib/profiles';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const profile = resolveProfile(new URL(req.url).searchParams.get('profile'));
    return Response.json(await profileDetails(profile));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const profile = resolveProfile(new URL(req.url).searchParams.get('profile'));
    const { markdown } = await req.json().catch(() => ({}));
    if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 200000) {
      return Response.json({ error: 'Profile text is empty or too long.' }, { status: 400 });
    }
    await saveProfileMarkdown(profile, markdown);
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
