import { handleApiRequest } from "../../lib/http.js";

export default async function handler(req, res) {
  const url = new URL("/api/cron/reminders", `https://${req.headers.host || "localhost"}`);
  if (req.query?.secret) url.searchParams.set("secret", req.query.secret);
  return handleApiRequest(req, res, url);
}
