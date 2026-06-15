export function getDatabaseUrl() {
  const raw =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.SUPABASE_DB_URL ||
    "";

  if (!raw || process.env.POSTGRES_SSL_VERIFY === "true") return raw;

  try {
    const url = new URL(raw);
    const sslMode = url.searchParams.get("sslmode");
    if (sslMode === "require") {
      url.searchParams.set("sslmode", "no-verify");
      return url.toString();
    }
    return raw;
  } catch {
    return raw;
  }
}
