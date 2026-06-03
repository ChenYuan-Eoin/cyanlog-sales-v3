-- SpaceX级确定性报价单号生成
-- 消除 Math.random() 冲突风险

CREATE SEQUENCE IF NOT EXISTS quote_number_seq START 1000;

CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS TEXT AS $$
DECLARE
  seq_num INTEGER;
  date_str TEXT;
  result TEXT;
  attempts INTEGER := 0;
  max_attempts INTEGER := 3;
BEGIN
  LOOP
    attempts := attempts + 1;

    -- 原子获取序列号
    seq_num := nextval('quote_number_seq');
    date_str := to_char(CURRENT_DATE, 'YYYYMMDD');
    result := 'QT-' || date_str || '-' || LPAD(seq_num::TEXT, 4, '0');

    -- 检查冲突（防御性编程）
    IF NOT EXISTS (SELECT 1 FROM quotes WHERE quote_no = result) THEN
      RETURN result;
    END IF;

    -- 冲突时重试，超过最大次数则使用UUID后缀
    IF attempts >= max_attempts THEN
      result := result || '-' || substr(gen_random_uuid()::TEXT, 1, 4);
      RETURN result;
    END IF;

    -- 短暂延迟后重试
    PERFORM pg_sleep(0.01);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 添加唯一约束（如不存在）
DO $$
BEGIN
  IF to_regclass('public.quotes') IS NOT NULL
    AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quotes_quote_no_key'
  ) THEN
    ALTER TABLE quotes ADD CONSTRAINT quotes_quote_no_key UNIQUE (quote_no);
  END IF;
EXCEPTION
  WHEN duplicate_table OR undefined_table THEN NULL;
END $$;
