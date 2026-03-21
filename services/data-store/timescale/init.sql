CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS order_book_l1 (
  time        TIMESTAMPTZ NOT NULL,
  symbol      TEXT NOT NULL,
  bid         NUMERIC,
  ask         NUMERIC,
  bid_volume  BIGINT,
  ask_volume  BIGINT
);
SELECT create_hypertable('order_book_l1', 'time', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS institutional_activity (
  time        TIMESTAMPTZ NOT NULL,
  symbol      TEXT NOT NULL,
  net_volume  BIGINT,
  buy_volume  BIGINT,
  sell_volume BIGINT,
  anomaly_score NUMERIC
);
SELECT create_hypertable('institutional_activity', 'time', if_not_exists => TRUE);
