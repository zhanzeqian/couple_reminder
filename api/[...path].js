import { handleApiRequest } from "../lib/http.js";

export default async function handler(req, res) {
  const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
  return handleApiRequest(req, res, url);
}
