import { env } from 'cloudflare:workers';
import { ensureDemoReset } from '@/lib/demo-reset';
import { todayLA, users } from '@/lib/model';
export async function GET() {
  try {
    if (!env.DB)
      return Response.json({ error: 'Shared database is not configured.' }, { status: 503 });
    const today = todayLA();
    await ensureDemoReset(env.DB, today);
    const result = await env.DB.prepare('SELECT payload FROM accounts ORDER BY id').all<{
      payload: string;
    }>();
    return Response.json(
      { accounts: result.results.map((r) => JSON.parse(r.payload)), users, today },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error(e);
    return Response.json({ error: 'Unable to load shared customer data.' }, { status: 500 });
  }
}
