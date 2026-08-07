-- Per-developer leave days on sprints (Team Workload / Sprint Summary)
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS developer_leaves JSONB DEFAULT '{}';
