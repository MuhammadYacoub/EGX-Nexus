CREATE DATABASE IF NOT EXISTS egxnexus;
USE egxnexus;

CREATE TABLE IF NOT EXISTS stocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL UNIQUE,
  name_ar VARCHAR(100),
  name_en VARCHAR(100),
  sector VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_prices (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  date DATE NOT NULL,
  open DECIMAL(10,4),
  high DECIMAL(10,4),
  low DECIMAL(10,4),
  close DECIMAL(10,4),
  volume BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_symbol_date (symbol, date),
  INDEX idx_symbol (symbol),
  INDEX idx_date (date)
);

CREATE TABLE IF NOT EXISTS stock_features (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  date DATE NOT NULL,
  rsi DECIMAL(8,4),
  macd DECIMAL(10,6),
  bb_position DECIMAL(8,4),
  volume_ratio DECIMAL(8,4),
  price_change_5d DECIMAL(8,4),
  signal TINYINT COMMENT '-1=sell, 0=hold, 1=buy',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_symbol_date (symbol, date)
);
