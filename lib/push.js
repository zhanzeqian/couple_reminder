import webPush from "web-push";

let configured = false;

export function getPublicVapidKey() {
  return process.env.WEB_PUSH_PUBLIC_KEY || "";
}

function configureWebPush() {
  if (configured) return Boolean(getPublicVapidKey() && process.env.WEB_PUSH_PRIVATE_KEY);
  const publicKey = getPublicVapidKey();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT || "mailto:admin@example.com";

  if (!publicKey || !privateKey) return false;
  webPush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export async function sendPush(subscription, payload) {
  if (!subscription || !configureWebPush()) return { sent: false };

  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
    return { sent: true };
  } catch (error) {
    console.error("Web Push failed", error.statusCode || error.code || error.message);
    return { sent: false, error };
  }
}
