import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getDatabaseUrl } from "./database-url.js";

const dbPath = join(process.cwd(), "data", "db.json");

const defaultDb = {
  users: [],
  couples: [],
  invites: [],
  tasks: [],
  events: [],
  pushSubscriptions: []
};

let memoryDb = null;
let pgPool = null;

export function hasPostgres() {
  return Boolean(getDatabaseUrl());
}

async function getPool() {
  if (!hasPostgres()) return null;
  if (pgPool) return pgPool;
  const { Pool } = await import("pg");
  pgPool = new Pool({
    connectionString: getDatabaseUrl(),
    ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false }
  });
  return pgPool;
}

async function readJsonDb() {
  if (memoryDb) return memoryDb;
  try {
    const file = await readFile(dbPath, "utf8");
    memoryDb = { ...defaultDb, ...JSON.parse(file) };
  } catch {
    memoryDb = structuredClone(defaultDb);
    await writeJsonDb(memoryDb);
  }
  return memoryDb;
}

async function writeJsonDb(db) {
  await mkdir(dirname(dbPath), { recursive: true });
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function rowToUser(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    name: row.name,
    createdAt: row.created_at
  };
}

function rowToCouple(row) {
  return {
    id: row.id,
    userAId: row.user_a_id,
    userBId: row.user_b_id,
    createdAt: row.created_at
  };
}

function rowToInvite(row) {
  return {
    id: row.id,
    code: row.code,
    createdBy: row.created_by,
    usedBy: row.used_by,
    createdAt: row.created_at
  };
}

function rowToTask(row) {
  return {
    id: row.id,
    coupleId: row.couple_id,
    creatorId: row.creator_id,
    assigneeId: row.assignee_id,
    title: row.title,
    note: row.note || "",
    dueAt: row.due_at,
    intervalMinutes: Number(row.interval_minutes || 0),
    penaltyAmount: Number(row.penalty_amount || 0),
    priority: row.priority,
    status: row.status,
    remindCount: Number(row.remind_count || 0),
    lastRemindedAt: row.last_reminded_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

function rowToEvent(row) {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    type: row.type,
    title: row.title,
    body: row.body,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at
  };
}

export async function withDb(mutator) {
  const pool = await getPool();
  if (!pool) {
    const db = await readJsonDb();
    const result = await mutator(db);
    await writeJsonDb(db);
    return result;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const db = createPgFacade(client);
    const result = await mutator(db);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function readDb(reader) {
  const pool = await getPool();
  if (!pool) return reader(await readJsonDb());

  const client = await pool.connect();
  try {
    return reader(createPgFacade(client));
  } finally {
    client.release();
  }
}

function createPgFacade(client) {
  return {
    async getUserByDeviceId(deviceId) {
      const res = await client.query("select * from users where device_id = $1", [deviceId]);
      return res.rows[0] ? rowToUser(res.rows[0]) : null;
    },
    async getUserById(id) {
      const res = await client.query("select * from users where id = $1", [id]);
      return res.rows[0] ? rowToUser(res.rows[0]) : null;
    },
    async insertUser(user) {
      await client.query(
        "insert into users (id, device_id, name, created_at) values ($1, $2, $3, $4)",
        [user.id, user.deviceId, user.name, user.createdAt]
      );
      return user;
    },
    async updateUserName(id, name) {
      await client.query("update users set name = $1 where id = $2", [name, id]);
    },
    async getCoupleForUser(userId) {
      const res = await client.query(
        "select * from couples where user_a_id = $1 or user_b_id = $1 limit 1",
        [userId]
      );
      return res.rows[0] ? rowToCouple(res.rows[0]) : null;
    },
    async insertCouple(couple) {
      await client.query(
        "insert into couples (id, user_a_id, user_b_id, created_at) values ($1, $2, $3, $4)",
        [couple.id, couple.userAId, couple.userBId, couple.createdAt]
      );
      return couple;
    },
    async removeInvitesByCreator(userId) {
      await client.query("delete from invites where created_by = $1 and used_by is null", [userId]);
    },
    async insertInvite(invite) {
      await client.query(
        "insert into invites (id, code, created_by, used_by, created_at) values ($1, $2, $3, $4, $5)",
        [invite.id, invite.code, invite.createdBy, invite.usedBy, invite.createdAt]
      );
      return invite;
    },
    async getInviteByCode(code) {
      const res = await client.query("select * from invites where code = $1 limit 1", [code]);
      return res.rows[0] ? rowToInvite(res.rows[0]) : null;
    },
    async markInviteUsed(id, userId) {
      await client.query("update invites set used_by = $1 where id = $2", [userId, id]);
    },
    async getTasksForCouple(coupleId) {
      const res = await client.query("select * from tasks where couple_id = $1", [coupleId]);
      return res.rows.map(rowToTask);
    },
    async insertTask(task) {
      await client.query(
        `insert into tasks
          (id, couple_id, creator_id, assignee_id, title, note, due_at, interval_minutes, penalty_amount, priority, status, remind_count, last_reminded_at, completed_at, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          task.id,
          task.coupleId,
          task.creatorId,
          task.assigneeId,
          task.title,
          task.note,
          task.dueAt,
          task.intervalMinutes,
          task.penaltyAmount,
          task.priority,
          task.status,
          task.remindCount,
          task.lastRemindedAt,
          task.completedAt,
          task.createdAt
        ]
      );
      return task;
    },
    async getTaskById(id) {
      const res = await client.query("select * from tasks where id = $1", [id]);
      return res.rows[0] ? rowToTask(res.rows[0]) : null;
    },
    async updateTask(task) {
      await client.query(
        `update tasks set due_at = $1, status = $2, remind_count = $3, last_reminded_at = $4, completed_at = $5
          where id = $6`,
        [task.dueAt, task.status, task.remindCount, task.lastRemindedAt, task.completedAt, task.id]
      );
      return task;
    },
    async getDueTasks(nowIso) {
      const res = await client.query(
        `select * from tasks
          where status <> 'done'
          and due_at <= $1
          and (
            last_reminded_at is null
            or (interval_minutes > 0 and last_reminded_at <= ($1::timestamptz - (interval_minutes || ' minutes')::interval))
          )`,
        [nowIso]
      );
      return res.rows.map(rowToTask);
    },
    async insertEvent(event) {
      await client.query(
        `insert into events (id, user_id, task_id, type, title, body, delivered_at, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          event.id,
          event.userId,
          event.taskId,
          event.type,
          event.title,
          event.body,
          event.deliveredAt,
          event.createdAt
        ]
      );
      return event;
    },
    async getUndeliveredEvents(userId) {
      const res = await client.query(
        "select * from events where user_id = $1 and delivered_at is null order by created_at asc",
        [userId]
      );
      return res.rows.map(rowToEvent);
    },
    async markEventsDelivered(ids, deliveredAt) {
      if (!ids.length) return;
      await client.query("update events set delivered_at = $1 where id = any($2::text[])", [deliveredAt, ids]);
    },
    async upsertPushSubscription(userId, subscription) {
      await client.query("delete from push_subscriptions where user_id = $1", [userId]);
      await client.query(
        "insert into push_subscriptions (id, user_id, subscription, created_at) values ($1, $2, $3, $4)",
        [`sub_${Date.now().toString(36)}`, userId, JSON.stringify(subscription), new Date().toISOString()]
      );
    },
    async getPushSubscription(userId) {
      const res = await client.query("select subscription from push_subscriptions where user_id = $1 limit 1", [userId]);
      return res.rows[0]?.subscription || null;
    }
  };
}

export function createJsonFacade(db) {
  return {
    async getUserByDeviceId(deviceId) {
      return db.users.find((user) => user.deviceId === deviceId) || null;
    },
    async getUserById(id) {
      return db.users.find((user) => user.id === id) || null;
    },
    async insertUser(user) {
      db.users.push(user);
      return user;
    },
    async updateUserName(id, name) {
      const user = db.users.find((item) => item.id === id);
      if (user) user.name = name;
    },
    async getCoupleForUser(userId) {
      return db.couples.find((couple) => couple.userAId === userId || couple.userBId === userId) || null;
    },
    async insertCouple(couple) {
      db.couples.push(couple);
      return couple;
    },
    async removeInvitesByCreator(userId) {
      db.invites = db.invites.filter((invite) => invite.createdBy !== userId || invite.usedBy);
    },
    async insertInvite(invite) {
      db.invites.push(invite);
      return invite;
    },
    async getInviteByCode(code) {
      return db.invites.find((invite) => invite.code === code) || null;
    },
    async markInviteUsed(id, userId) {
      const invite = db.invites.find((item) => item.id === id);
      if (invite) invite.usedBy = userId;
    },
    async getTasksForCouple(coupleId) {
      return db.tasks.filter((task) => task.coupleId === coupleId);
    },
    async insertTask(task) {
      db.tasks.push(task);
      return task;
    },
    async getTaskById(id) {
      return db.tasks.find((task) => task.id === id) || null;
    },
    async updateTask(task) {
      return task;
    },
    async getDueTasks() {
      return db.tasks.filter((task) => {
        if (task.status === "done") return false;
        if (Date.now() < new Date(task.dueAt).getTime()) return false;
        if (!task.lastRemindedAt) return true;
        if (!task.intervalMinutes) return false;
        return Date.now() - new Date(task.lastRemindedAt).getTime() >= task.intervalMinutes * 60000;
      });
    },
    async insertEvent(event) {
      db.events.push(event);
      return event;
    },
    async getUndeliveredEvents(userId) {
      return db.events.filter((event) => event.userId === userId && !event.deliveredAt);
    },
    async markEventsDelivered(ids, deliveredAt) {
      const idSet = new Set(ids);
      for (const event of db.events) {
        if (idSet.has(event.id)) event.deliveredAt = deliveredAt;
      }
    },
    async upsertPushSubscription(userId, subscription) {
      db.pushSubscriptions = db.pushSubscriptions.filter((item) => item.userId !== userId);
      db.pushSubscriptions.push({
        id: `sub_${Date.now().toString(36)}`,
        userId,
        subscription,
        createdAt: new Date().toISOString()
      });
    },
    async getPushSubscription(userId) {
      return db.pushSubscriptions.find((item) => item.userId === userId)?.subscription || null;
    }
  };
}

export async function withStore(mutator) {
  return withDb(async (db) => {
    const store = typeof db.getUserByDeviceId === "function" ? db : createJsonFacade(db);
    return mutator(store);
  });
}

export async function readStore(reader) {
  return readDb(async (db) => {
    const store = typeof db.getUserByDeviceId === "function" ? db : createJsonFacade(db);
    return reader(store);
  });
}
