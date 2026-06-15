import {
  bootstrap,
  createInvite,
  createTask,
  HttpError,
  getPushConfig,
  joinCouple,
  listTasks,
  pollEvents,
  runReminderScan,
  saveProfile,
  savePushSubscription,
  updateTask
} from "./app.js";

export async function handleApiRequest(req, res, url = new URL(req.url || "/", "http://localhost")) {
  try {
    const data = await route(req, url);
    sendJson(res, data.status || 200, data.body ?? data);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(res, status, { error: error.message || "Server error" });
  }
}

async function route(req, url) {
  const path = normalizeApiPath(url.pathname);

  if (req.method === "GET" && path === "/bootstrap") {
    return { body: await bootstrap(url.searchParams.get("deviceId")) };
  }

  if (req.method === "POST" && path === "/profile") {
    return { body: await saveProfile(await readJson(req)) };
  }

  if (req.method === "POST" && path === "/invites") {
    return { body: await createInvite(await readJson(req)) };
  }

  if (req.method === "POST" && path === "/couples/join") {
    return { body: await joinCouple(await readJson(req)) };
  }

  if (req.method === "GET" && path === "/tasks") {
    return { body: await listTasks(url.searchParams.get("deviceId")) };
  }

  if (req.method === "POST" && path === "/tasks") {
    return { status: 201, body: await createTask(await readJson(req)) };
  }

  const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch && req.method === "PATCH") {
    return { body: await updateTask(taskMatch[1], await readJson(req)) };
  }

  if (req.method === "GET" && path === "/events") {
    return { body: await pollEvents(url.searchParams.get("deviceId")) };
  }

  if (req.method === "POST" && path === "/push-subscriptions") {
    return { body: await savePushSubscription(await readJson(req)) };
  }

  if (req.method === "GET" && path === "/push-config") {
    return { body: getPushConfig() };
  }

  if (req.method === "GET" && path === "/cron/reminders") {
    assertCronSecret(req, url);
    return { body: await runReminderScan() };
  }

  throw new HttpError(404, "Not found");
}

function normalizeApiPath(pathname) {
  return pathname.replace(/^\/api(?:\/index)?/, "") || "/";
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertCronSecret(req, url) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  if (req.headers["x-vercel-cron"] === "1") return;
  const header = req.headers.authorization || "";
  const querySecret = url.searchParams.get("secret");
  if (header === `Bearer ${secret}` || querySecret === secret) return;
  throw new HttpError(401, "Invalid cron secret");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
