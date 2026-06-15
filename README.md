# Couple Reminder PWA

一个情侣之间互相提醒未完成事项的 PWA MVP。当前版本包含 Node 后端、JSON 数据持久化、邀请码绑定、任务同步、定时扫描和提醒事件轮询，可以部署成两台 iPhone 共用的早期正式版。

## 启动

```bash
npm start
```

打开：

```text
http://127.0.0.1:4173
```

## iPhone 安装方式

1. 用 Safari 打开部署后的 HTTPS 地址。
2. 点分享按钮。
3. 选择“添加到主屏幕”。
4. 从桌面图标打开 PWA。
5. 在应用内点右上角通知按钮，允许通知。

iOS Web Push 需要 iOS 16.4+，并且必须是添加到主屏幕后打开的 PWA 才适合正式接通知。

## 当前已实现

- 设置两个人的名字
- 生成邀请码
- 输入邀请码绑定另一台设备
- 创建提醒事项
- 指派给“我”或“TA”
- 截止时间、提醒频率、重要程度、备注
- 我的待办、给 TA 的、已完成三个视图
- 完成任务
- 延期 1 小时
- PWA manifest
- Service Worker 离线缓存
- 本地通知权限申请
- 后端每 30 秒扫描到期任务
- 前端轮询提醒事件并弹出系统通知

## 当前边界

数据现在保存在服务器本地文件：

```text
data/db.json
```

这适合两个人自用的 MVP，但生产长期使用最好换成 Postgres/Supabase。当前提醒事件在 PWA 打开或后台仍活跃时通过轮询送达；iPhone 锁屏后长期可靠提醒需要继续接真正的 Web Push。

## 还需要升级的能力

- 登录
- Postgres/Supabase 数据库
- Web Push VAPID 公钥配置
- PushManager 订阅
- 服务端 Web Push 加密发送
- 免打扰时间
- 每日提醒次数上限
- 管理后台或导出备份

推荐下一步技术栈：

- Supabase Auth
- Supabase Postgres
- Supabase Edge Functions 或 Node.js Worker
- Web Push VAPID

## 第一版后端表结构草案

```sql
users(id, name, email, push_subscription, quiet_hours_start, quiet_hours_end)
couples(id, user_a_id, user_b_id, invite_code, created_at)
tasks(id, couple_id, creator_id, assignee_id, title, note, due_at, remind_interval_minutes, priority, status, last_reminded_at, completed_at, created_at)
task_events(id, task_id, actor_id, type, message, created_at)
```

## 部署建议

## Vercel 部署

Vercel 不能依赖本地 `data/db.json` 和常驻 `setInterval`。部署到 Vercel 时使用：

```text
Vercel Functions -> /api/*
Vercel Cron -> /api/cron/reminders
Postgres -> DATABASE_URL
```

### 1. 创建数据库

推荐 Supabase 或 Neon。创建 Postgres 后，把 [db/schema.sql](./db/schema.sql) 里的 SQL 在数据库控制台执行一遍。

如果你通过 Vercel Integrations 创建 Supabase，进入 Vercel 项目的 Settings -> Environment Variables，确认是否已经有下面任意一个变量：

```text
DATABASE_URL
POSTGRES_URL_NON_POOLING
POSTGRES_URL
POSTGRES_PRISMA_URL
SUPABASE_DB_URL
```

代码会按这个顺序自动读取。只要其中一个存在即可。

### 2. 配置环境变量

在 Vercel Project Settings -> Environment Variables 添加：

```text
CRON_SECRET=自己生成的长随机字符串
```

如果 Vercel Supabase integration 没有自动添加数据库连接串，再手动添加：

```text
DATABASE_URL=postgresql://...
```

如果数据库提供商要求 SSL，保持默认即可。若你用的是不需要 SSL 的本地 Postgres，可以加：

```text
POSTGRES_SSL=false
```

后续接真正 Web Push 时再添加：

```text
WEB_PUSH_PUBLIC_KEY=...
WEB_PUSH_PRIVATE_KEY=...
WEB_PUSH_SUBJECT=mailto:your-email@example.com
```

### 3. 导入 GitHub 仓库

1. 把项目推到 GitHub。
2. Vercel 新建项目并导入该仓库。
3. Framework Preset 选 `Other`。
4. Build Command 留空。
5. Output Directory 留空。
6. Deploy。

### 3.1 建表

任选一种：

方式 A：在 Supabase SQL Editor 执行 [db/schema.sql](./db/schema.sql)。

方式 B：本地有数据库环境变量时运行：

```bash
npm run db:migrate
npm run db:check
```

Vercel 的自动部署不会默认执行建表脚本，所以第一次上线前必须做一次建表。

### 4. Cron

[vercel.json](./vercel.json) 已配置：

```json
{
  "path": "/api/cron/reminders",
  "schedule": "*/5 * * * *"
}
```

这表示 Vercel 每 5 分钟扫描一次到期任务。Vercel Cron 的最小频率和可用性取决于账号套餐；如果你需要 30 秒级提醒，Vercel 不适合单独承担调度，需要换成外部 Worker 或队列。

### 5. iPhone 使用

1. 部署后用 Vercel 的 HTTPS 地址在 iPhone Safari 打开。
2. 分享 -> 添加到主屏幕。
3. 从主屏幕图标打开。
4. 点右上角通知按钮允许通知。
5. 一台手机生成邀请码，另一台手机输入邀请码绑定。

当前 Vercel 版仍然以“轮询事件 + 本地通知”为主。锁屏后长期可靠推送需要继续接 Web Push 的 VAPID 发送逻辑。
