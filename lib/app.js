import { readStore, withStore } from "./store.js";
import { getPublicVapidKey, sendPush } from "./push.js";

export function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function inviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name };
}

function publicTask(task, user) {
  return {
    ...task,
    assigneeRole: task.assigneeId === user.id ? "me" : "partner",
    creatorRole: task.creatorId === user.id ? "me" : "partner"
  };
}

async function getOrCreateUser(store, deviceId, name = "") {
  if (!deviceId) throw new HttpError(400, "缺少设备 ID");
  let user = await store.getUserByDeviceId(deviceId);
  if (user) {
    if (name && user.name !== name) {
      await store.updateUserName(user.id, name);
      user = { ...user, name };
    }
    return user;
  }

  user = {
    id: makeId("usr"),
    deviceId,
    name,
    createdAt: new Date().toISOString()
  };
  return store.insertUser(user);
}

async function getPartner(store, couple, userId) {
  if (!couple) return null;
  const partnerId = couple.userAId === userId ? couple.userBId : couple.userAId;
  return store.getUserById(partnerId);
}

async function createEvent(store, { userId, taskId, type, title, body }) {
  const event = await store.insertEvent({
    id: makeId("evt"),
    userId,
    taskId,
    type,
    title,
    body,
    deliveredAt: null,
    createdAt: new Date().toISOString()
  });
  const subscription = await store.getPushSubscription(userId);
  const result = await sendPush(subscription, {
    eventId: event.id,
    title,
    body,
    type,
    taskId,
    url: "/"
  });
  if (result.sent) {
    const deliveredAt = new Date().toISOString();
    await store.markEventsDelivered([event.id], deliveredAt);
    event.deliveredAt = deliveredAt;
  }
  return event;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function bootstrap(deviceId) {
  return withStore(async (store) => {
    const user = await getOrCreateUser(store, deviceId || makeId("dev"));
    const couple = await store.getCoupleForUser(user.id);
    const partner = await getPartner(store, couple, user.id);
    const tasks = couple ? await store.getTasksForCouple(couple.id) : [];
    return {
      user: publicUser(user),
      couple: couple ? { id: couple.id } : null,
      partner: publicUser(partner),
      tasks: tasks.map((task) => publicTask(task, user))
    };
  });
}

export async function saveProfile({ deviceId, name }) {
  return withStore(async (store) => {
    const user = await getOrCreateUser(store, deviceId, name?.trim());
    return { user: publicUser(user) };
  });
}

export async function createInvite({ deviceId }) {
  return withStore(async (store) => {
    const user = await getOrCreateUser(store, deviceId);
    let code = inviteCode();
    while (await store.getInviteByCode(code)) code = inviteCode();

    await store.removeInvitesByCreator(user.id);
    await store.insertInvite({
      id: makeId("inv"),
      code,
      createdBy: user.id,
      usedBy: null,
      createdAt: new Date().toISOString()
    });
    return { code };
  });
}

export async function joinCouple({ deviceId, name, code }) {
  return withStore(async (store) => {
    const user = await getOrCreateUser(store, deviceId, name?.trim());
    const invite = await store.getInviteByCode(String(code || "").trim().toUpperCase());
    if (!invite || invite.usedBy) throw new HttpError(404, "邀请码无效或已使用");
    if (invite.createdBy === user.id) throw new HttpError(400, "不能使用自己的邀请码");
    if (await store.getCoupleForUser(user.id)) throw new HttpError(409, "你已经绑定");
    if (await store.getCoupleForUser(invite.createdBy)) throw new HttpError(409, "对方已经绑定");

    await store.markInviteUsed(invite.id, user.id);
    const couple = await store.insertCouple({
      id: makeId("cpl"),
      userAId: invite.createdBy,
      userBId: user.id,
      createdAt: new Date().toISOString()
    });
    return { couple: { id: couple.id }, partner: publicUser(await getPartner(store, couple, user.id)) };
  });
}

export async function listTasks(deviceId) {
  return readStore(async (store) => {
    const user = await store.getUserByDeviceId(deviceId);
    if (!user) throw new HttpError(401, "未识别设备");
    const couple = await store.getCoupleForUser(user.id);
    const tasks = couple ? await store.getTasksForCouple(couple.id) : [];
    return { tasks: tasks.map((task) => publicTask(task, user)) };
  });
}

export async function createTask(body) {
  return withStore(async (store) => {
    const user = await store.getUserByDeviceId(body.deviceId);
    if (!user) throw new HttpError(401, "未识别设备");

    const couple = await store.getCoupleForUser(user.id);
    if (!couple) throw new HttpError(409, "请先绑定对方");

    const partner = await getPartner(store, couple, user.id);
    const assigneeId = body.assignee === "me" ? user.id : partner?.id;
    if (!assigneeId) throw new HttpError(400, "找不到执行人");

    const task = {
      id: makeId("tsk"),
      coupleId: couple.id,
      creatorId: user.id,
      assigneeId,
      title: String(body.title || "").trim(),
      note: String(body.note || "").trim(),
      dueAt: new Date(body.dueAt).toISOString(),
      intervalMinutes: Number(body.intervalMinutes || 0),
      penaltyAmount: Math.max(0, Number(body.penaltyAmount || 0)),
      priority: body.priority === "important" ? "important" : "normal",
      status: "pending",
      remindCount: 0,
      lastRemindedAt: null,
      completedAt: null,
      createdAt: new Date().toISOString()
    };
    if (!task.title) throw new HttpError(400, "事项不能为空");

    await store.insertTask(task);
    if (assigneeId !== user.id) {
      await createEvent(store, {
        userId: assigneeId,
        taskId: task.id,
        type: "assigned",
        title: "新的提醒事项",
        body: `${user.name || "对方"} 提醒你：${task.title}`
      });
    }
    return { task: publicTask(task, user) };
  });
}

export async function updateTask(taskId, body) {
  return withStore(async (store) => {
    const user = await store.getUserByDeviceId(body.deviceId);
    const task = await store.getTaskById(taskId);
    if (!user || !task) throw new HttpError(404, "任务不存在");
    if (task.assigneeId !== user.id) throw new HttpError(403, "只有执行人可以操作这个任务");

    if (body.action === "complete") {
      task.status = "done";
      task.completedAt = new Date().toISOString();
      if (task.creatorId !== user.id) {
        await createEvent(store, {
          userId: task.creatorId,
          taskId: task.id,
          type: "completed",
          title: "事项已完成",
          body: `${user.name || "对方"} 已完成：${task.title}`
        });
      }
    }

    if (body.action === "delay") {
      const minutes = Number(body.minutes || 60);
      task.dueAt = new Date(new Date(task.dueAt).getTime() + minutes * 60000).toISOString();
    }

    await store.updateTask(task);
    return { task: publicTask(task, user) };
  });
}

export async function pollEvents(deviceId) {
  return withStore(async (store) => {
    const user = await store.getUserByDeviceId(deviceId);
    if (!user) throw new HttpError(401, "未识别设备");

    await scanDueTasks(store);
    const events = await store.getUndeliveredEvents(user.id);
    await store.markEventsDelivered(events.map((event) => event.id), new Date().toISOString());
    return { events };
  });
}

export async function savePushSubscription({ deviceId, subscription }) {
  return withStore(async (store) => {
    const user = await store.getUserByDeviceId(deviceId);
    if (!user) throw new HttpError(401, "未识别设备");
    await store.upsertPushSubscription(user.id, subscription);
    return { ok: true };
  });
}

export function getPushConfig() {
  return { publicKey: getPublicVapidKey() };
}

export async function runReminderScan() {
  return withStore(async (store) => {
    return { scanned: await scanDueTasks(store) };
  });
}

async function scanDueTasks(store) {
  const dueTasks = await store.getDueTasks(new Date().toISOString());
  for (const task of dueTasks) {
    task.lastRemindedAt = new Date().toISOString();
    task.remindCount += 1;
    await store.updateTask(task);
    await createEvent(store, {
      userId: task.assigneeId,
      taskId: task.id,
      type: "reminder",
      title: "待完成事项",
      body: `${task.title}，截止 ${new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(task.dueAt))}`
    });
  }
  return dueTasks.length;
}
