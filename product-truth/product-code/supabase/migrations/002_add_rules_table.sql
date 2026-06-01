-- Migration: Add rules table for contract review rule engine
-- REQ:F006

-- Rules table for storing contract review rules
CREATE TABLE IF NOT EXISTS rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rule_type VARCHAR(20) NOT NULL CHECK (rule_type IN ('structured', 'semantic')),
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('red', 'yellow', 'green')),
    enabled BOOLEAN DEFAULT true,
    config JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for enabled rules (used by rule engine)
CREATE INDEX idx_rules_enabled ON rules(enabled);

-- Index for rule type filtering
CREATE INDEX idx_rules_type ON rules(rule_type);

-- Enable RLS
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;

-- Policy: All authenticated users can read rules
CREATE POLICY "Allow authenticated read rules"
    ON rules FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Only admins can create/update/delete rules
-- Note: In production, you might want to check a role column
CREATE POLICY "Allow authenticated create rules"
    ON rules FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Allow authenticated update rules"
    ON rules FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated delete rules"
    ON rules FOR DELETE
    TO authenticated
    USING (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_rules_updated_at
    BEFORE UPDATE ON rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default rules
INSERT INTO rules (name, description, rule_type, risk_level, enabled, config) VALUES
(
    '付款账期检查',
    '账期超过90天触发红灯警告',
    'structured',
    'red',
    true,
    '{"field": "账期", "operator": "gt", "value": 90}'
),
(
    '违约金比例检查',
    '违约金超过5%触发黄灯警告',
    'structured',
    'yellow',
    true,
    '{"field": "违约金", "operator": "gt", "value": 5}'
),
(
    '合同期限合理性',
    '检查合同期限是否合理',
    'semantic',
    'yellow',
    true,
    '{"prompt": "检查合同期限条款是否存在明显不合理之处，如期限过长或过短"}'
);
