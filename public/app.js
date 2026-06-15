const deviceKey = "couple-reminder-device-id-v1";
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
      card.querySelector(".complete-button").addEventListener("click", () => completeTask(task.id));
      card.querySelector(".delay-button").addEventListener("click", () => delayTask(task.id));
    }

    list.append(card);
  }
}

async function savePeople() {
  const name = people.me.value.trim();
  if (!name) {
    alert("先填你的名字。");
    return;
  }

  await api("/api/profile", {
    method: "POST",
    body: JSON.stringify({ deviceId, name })
  });
  await bootstrap();
}

async function createInvite() {
  await savePeople();
  const data = await api("/api/invites", {
    method: "POST",
    body: JSON.stringify({ deviceId })
  });
  $("#inviteCode").value = data.code;
}

async function joinInvite() {
  const name = people.me.value.trim();
  const code = $("#joinCode").value.trim();
  if (!name || !code) {
    alert("请填你的名字和对方的邀请码。");
    return;
  }

  await api("/api/couples/join", {
    method: "POST",
    body: JSON.stringify({ deviceId, name, code })
  });
  await bootstrap();
}

async function createTask(event) {
  event.preventDefault();
  if (!appState.couple) {
    alert("请先绑定对方。");
    return;
  }

  await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      deviceId,
      title: $("#titleInput").value.trim(),
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
}

async function refreshTasks() {
  if (!appState.user) return;
  const data = await api(`/api/tasks?deviceId=${encodeURIComponent(deviceId)}`);
  appState.tasks = data.tasks;
  renderTasks();
}

async function completeTask(id) {
  await api(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ deviceId, action: "complete" })
  });
  await refreshTasks();
}

async function delayTask(id) {
  await api(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ deviceId, action: "delay", minutes: 60 })
  });
  await refreshTasks();
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    alert("这个浏览器暂不支持通知。");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    showLocalNotification("通知已开启", "提醒事件会先通过轮询送达。");
    await registerPushSubscription();
  }
  updateNotifyButton();
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

function showToast(title, body) {
  const zone = $("#toastZone");
  const toast = document.createElement("div");
  toast.className = "toast";
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
