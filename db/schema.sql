create table if not exists users (
  id text primary key,
  device_id text unique not null,
  name text not null default '',
  created_at timestamptz not null
);

create table if not exists couples (
  id text primary key,
  user_a_id text not null references users(id) on delete cascade,
  user_b_id text not null references users(id) on delete cascade,
  created_at timestamptz not null,
  unique (user_a_id),
  unique (user_b_id)
);

create table if not exists invites (
  id text primary key,
  code text unique not null,
  created_by text not null references users(id) on delete cascade,
  used_by text references users(id) on delete set null,
  created_at timestamptz not null
);

create table if not exists tasks (
  id text primary key,
  couple_id text not null references couples(id) on delete cascade,
  creator_id text not null references users(id) on delete cascade,
  assignee_id text not null references users(id) on delete cascade,
  title text not null,
  note text not null default '',
  due_at timestamptz not null,
  interval_minutes integer not null default 0,
  penalty_amount numeric(10, 2) not null default 0,
  priority text not null default 'normal',
  status text not null default 'pending',
  remind_count integer not null default 0,
  last_reminded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null
);

create index if not exists tasks_due_idx on tasks (status, due_at, last_reminded_at);
create index if not exists tasks_couple_idx on tasks (couple_id);

alter table tasks add column if not exists penalty_amount numeric(10, 2) not null default 0;

create table if not exists events (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  task_id text references tasks(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  delivered_at timestamptz,
  created_at timestamptz not null
);

create index if not exists events_delivery_idx on events (user_id, delivered_at, created_at);

create table if not exists push_subscriptions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null
);

create unique index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
