export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.DATABASE_URL;
  return Response.json({
    hasDatabaseUrl: Boolean(url),
    length: url?.length ?? 0,
    startsWith: url?.slice(0, 20) ?? null,
    hasDirectUrl: Boolean(process.env.DIRECT_URL),
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  });
}