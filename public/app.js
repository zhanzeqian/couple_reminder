const deviceKey = "couple-reminder-device-id-v1";
const seenEventsKey = "couple-reminder-seen-events-v1";
const $ = (selector) => document.querySelector(selector);
const now = () => new Date();

let appState = {
  user: null,
  partner: null,
  couple: null,
  tasks: []
};
let currentView = "mine";

const people = {
  me: $("#meInput"),
  partner: $("#partnerInput")
};

function getDeviceId() {
  let deviceId = localStorage.getItem(deviceKey);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(deviceKey, deviceId);
  }
  return deviceId;
}

const deviceId = getDeviceId();

function hasSeenEvent(eventId) {
  if (!eventId) return false;
  try {
    const seen = JSON.parse(localStorage.getItem(seenEventsKey) || "[]");
    return seen.includes(eventId);
  } catch {
    return false;
  }
}

function markEventSeen(eventId) {
  if (!eventId) return;
  let seen = [];
  try {
    seen = JSON.parse(localStorage.getItem(seenEventsKey) || "[]");
  } catch {
    seen = [];
  }
  const next = [eventId, ...seen.filter((id) => id !== eventId)].slice(0, 80);
  localStorage.setItem(seenEventsKey, JSON.stringify(next));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function withAction(button, pendingText, action) {
  const originalText = button?.textContent;
  const originalHtml = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.textContent = pendingText;
  }

  try {
    const result = await action();
    return result;
  } catch (error) {
    showToast("操作失败", error.message || "请稍后再试。", "error");
    throw error;
  } finally {
    if (button) {
      button.disabled = false;
      if (button.classList.contains("icon-button")) {
        button.innerHTML = originalHtml;
      } else {
        button.textContent = originalText;
      }
    }
  }
}

async function bootstrap() {
  appState = await api(`/api/bootstrap?deviceId=${encodeURIComponent(deviceId)}`);
  people.me.value = appState.user?.name || "";
  people.partner.value = appState.partner?.name || "";
  setupDefaults();
  renderPairing();
  renderTasks();
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function toLocalDateTimeInputValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function getAssigneeName(task) {
  return task.assigneeRole === "me" ? appState.user?.name || "我" : appState.partner?.name || "TA";
}

function getCreatorName(task) {
  return task.creatorRole === "me" ? appState.user?.name || "我" : appState.partner?.name || "TA";
}

function setupDefaults() {
  $("#setupPanel").classList.toggle("hidden", Boolean(appState.user?.name && appState.couple));
  $("#todayText").textContent = new Intl.DateTimeFormat("zh-CN", {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(now());

  const defaultDue = new Date(Date.now() + 2 * 60 * 60 * 1000);
  defaultDue.setMinutes(Math.ceil(defaultDue.getMinutes() / 5) * 5);
  $("#dueInput").value = toLocalDateTimeInputValue(defaultDue);
}

function renderPairing() {
  const pairStatus = $("#pairStatus");
  const inviteTools = $("#inviteTools");
  if (!pairStatus || !inviteTools) return;

  if (appState.couple) {
    pairStatus.textContent = `已和 ${appState.partner?.name || "TA"} 绑定`;
    inviteTools.classList.add("hidden");
    return;
  }

  pairStatus.textContent = "还没有绑定对方";
  inviteTools.classList.remove("hidden");
}

function renderTasks() {
  const list = $("#taskList");
  const template = $("#taskTemplate");
  list.innerHTML = "";

  const tasks = appState.tasks
    .filter((task) => {
      if (currentView === "mine") return task.assigneeRole === "me" && task.status !== "done";
      if (currentView === "sent") return task.creatorRole === "me" && task.assigneeRole !== "me" && task.status !== "done";
      return task.status === "done";
    })
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));

  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = currentView === "done" ? "还没有完成记录。" : "这里暂时没有未完成事项。";
    list.append(empty);
    return;
  }

  for (const task of tasks) {
    const card = template.content.firstElementChild.cloneNode(true);
    const overdue = Date.now() > new Date(task.dueAt).getTime() && task.status !== "done";

    card.querySelector(".task-kicker").textContent = `${getCreatorName(task)} 创建给 ${getAssigneeName(task)}`;
    card.querySelector("h3").textContent = task.title;
    card.querySelector(".task-note").textContent = task.note || "没有备注";

    const badge = card.querySelector(".badge");
    badge.textContent = task.status === "done" ? "已完成" : overdue ? "已逾期" : task.priority === "important" ? "重要" : "进行中";
    badge.classList.toggle("urgent", overdue || task.priority === "important");

    card.querySelector(".task-meta").innerHTML = [
      `截止 ${formatDateTime(task.dueAt)}`,
      task.intervalMinutes ? `${task.intervalMinutes >= 1440 ? "每天" : `每 ${task.intervalMinutes} 分钟`}提醒` : "只提醒一次",
      `已提醒 ${task.remindCount || 0} 次`
    ].map((text) => `<span>${text}</span>`).join("");

    const actions = card.querySelector(".task-actions");
    if (task.status === "done") {
      actions.remove();
    } else {
      card.querySelector(".complete-button").addEventListener("click", (event) => completeTask(task.id, event.currentTarget));
      card.querySelector(".delay-button").addEventListener("click", (event) => delayTask(task.id, event.currentTarget));
    }

    list.append(card);
  }
}

async function savePeople() {
  return withAction($("#savePeopleButton"), "保存中", async () => {
    const name = people.me.value.trim();
    if (!name) throw new Error("先填你的名字。");

    await api("/api/profile", {
      method: "POST",
      body: JSON.stringify({ deviceId, name })
    });
    await bootstrap();
    showToast("已保存", "你的名字已更新。", "success");
  });
}

async function createInvite() {
  return withAction($("#createInviteButton"), "生成中", async () => {
    await savePeople();
    const data = await api("/api/invites", {
      method: "POST",
      body: JSON.stringify({ deviceId })
    });
    $("#inviteCode").value = data.code;
    showToast("邀请码已生成", "把这个邀请码发给对方绑定。", "success");
  });
}

async function joinInvite() {
  return withAction($("#joinInviteButton"), "绑定中", async () => {
    const name = people.me.value.trim();
    const code = $("#joinCode").value.trim();
    if (!name || !code) throw new Error("请填你的名字和对方的邀请码。");

    await api("/api/couples/join", {
      method: "POST",
      body: JSON.stringify({ deviceId, name, code })
    });
    await bootstrap();
    showToast("绑定成功", `已和 ${appState.partner?.name || "TA"} 绑定。`, "success");
  });
}

async function createTask(event) {
  event.preventDefault();
  const button = event.submitter;
  return withAction(button, "创建中", async () => {
    if (!appState.couple) throw new Error("请先绑定对方。");

    const title = $("#titleInput").value.trim();
    if (!title) throw new Error("事项不能为空。");

    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        deviceId,
        title,
        note: $("#noteInput").value.trim(),
        dueAt: new Date($("#dueInput").value).toISOString(),
        assignee: $("#assigneeInput").value,
        intervalMinutes: Number($("#intervalInput").value),
        priority: $("#priorityInput").value
      })
    });

    event.target.reset();
    await refreshTasks();
    setupDefaults();
    showToast("创建成功", `已创建提醒：${title}`, "success");
  });
}

async function refreshTasks() {
  if (!appState.user) return;
  const data = await api(`/api/tasks?deviceId=${encodeURIComponent(deviceId)}`);
  appState.tasks = data.tasks;
  renderTasks();
}

async function completeTask(id, button) {
  return withAction(button, "完成中", async () => {
    const task = appState.tasks.find((item) => item.id === id);
    await api(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ deviceId, action: "complete" })
    });
    await refreshTasks();
    showToast("已完成", task ? `已标记完成：${task.title}` : "任务已完成。", "success");
  });
}

async function delayTask(id, button) {
  return withAction(button, "延期中", async () => {
    const task = appState.tasks.find((item) => item.id === id);
    await api(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ deviceId, action: "delay", minutes: 60 })
    });
    await refreshTasks();
    showToast("已延期", task ? `${task.title} 已延期 1 小时。` : "任务已延期。", "success");
  });
}

async function requestNotifications() {
  return withAction($("#notifyButton"), "...", async () => {
    if (!("Notification" in window)) throw new Error("这个浏览器暂不支持通知。");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("通知权限没有开启。");

    await registerPushSubscription();
    showToast("通知已开启", "之后会尝试通过系统推送提醒你。", "success");
    showLocalNotification("通知已开启", "之后会尝试通过系统推送提醒你。");
    updateNotifyButton();
  });
}

async function registerPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const config = await api("/api/push-config");
  if (!config.publicKey) {
    alert("服务器还没有配置 Web Push 公钥。");
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey)
    });
  }

  await api("/api/push-subscriptions", {
    method: "POST",
    body: JSON.stringify({ deviceId, subscription })
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function updateNotifyButton() {
  const button = $("#notifyButton");
  const granted = "Notification" in window && Notification.permission === "granted";
  button.title = granted ? "通知已开启" : "开启通知";
  button.setAttribute("aria-label", button.title);
  button.style.color = granted ? "var(--brand)" : "var(--accent)";
}

function showLocalNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  navigator.serviceWorker?.ready.then((registration) => {
    registration.showNotification(title, {
      body,
      icon: "/icons/icon.svg",
      badge: "/icons/icon.svg"
    });
  });
}

function showToast(title, body, tone = "info") {
  const zone = $("#toastZone");
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.innerHTML = `<strong></strong><span></span>`;
  toast.querySelector("strong").textContent = title;
  toast.querySelector("span").textContent = body;
  zone.append(toast);
  setTimeout(() => toast.remove(), 6000);
}

async function pollEvents() {
  if (!appState.user) return;
  try {
    const data = await api(`/api/events?deviceId=${encodeURIComponent(deviceId)}`);
    for (const event of data.events) {
      if (hasSeenEvent(event.id)) continue;
      markEventSeen(event.id);
      showToast(event.title, event.body);
      showLocalNotification(event.title, event.body);
    }
    if (data.events.length) await refreshTasks();
  } catch {
    // Polling should stay quiet while offline.
  }
}

async function registerPwa() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("/service-worker.js");
  }
}

$("#savePeopleButton").addEventListener("click", savePeople);
$("#createInviteButton").addEventListener("click", createInvite);
$("#joinInviteButton").addEventListener("click", joinInvite);
$("#taskForm").addEventListener("submit", createTask);
$("#notifyButton").addEventListener("click", requestNotifications);

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    currentView = tab.dataset.view;
    renderTasks();
  });
});

await registerPwa();
await bootstrap();
updateNotifyButton();
await pollEvents();
setInterval(refreshTasks, 15000);
setInterval(pollEvents, 10000);
