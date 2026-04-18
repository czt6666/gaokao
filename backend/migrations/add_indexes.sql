-- 缺失索引补充（幂等，使用 IF NOT EXISTS）
-- 运行: sqlite3 /app/backend/gaokao.db < add_indexes.sql

-- users: referred_by（推荐查询用）
CREATE INDEX IF NOT EXISTS ix_users_referred_by ON users(referred_by);

-- users: is_paid（付费用户过滤，高频查询）
CREATE INDEX IF NOT EXISTS ix_users_is_paid ON users(is_paid);

-- users: subscription_end_at（到期提醒查询）
CREATE INDEX IF NOT EXISTS ix_users_sub_end ON users(subscription_end_at);

-- users: created_at（今日新用户统计）
CREATE INDEX IF NOT EXISTS ix_users_created_at ON users(created_at);

-- orders: user_id（用户订单查找）
CREATE INDEX IF NOT EXISTS ix_orders_user_id ON orders(user_id);

-- orders: product_type（收入拆分查询）
CREATE INDEX IF NOT EXISTS ix_orders_product_type ON orders(product_type);

-- orders: pay_time（今日收入统计）
CREATE INDEX IF NOT EXISTS ix_orders_pay_time ON orders(pay_time);

-- user_events: user_id（用户行为查询）
CREATE INDEX IF NOT EXISTS ix_events_user_id ON user_events(user_id);

-- user_events: event_name + created_at（漏斗/热力图分析）
CREATE INDEX IF NOT EXISTS ix_events_name_time ON user_events(event_name, created_at);

-- ANALYZE（更新查询优化器统计信息）
ANALYZE;
