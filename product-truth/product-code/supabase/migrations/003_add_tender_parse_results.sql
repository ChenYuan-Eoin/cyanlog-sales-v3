-- Migration: Add tender_parse_results table for F008 OCR feature
-- REQ:F008

CREATE TABLE IF NOT EXISTS tender_parse_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tender_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PARSING', 'COMPLETED', 'FAILED')),
    extracted_data JSONB DEFAULT '{}',
    raw_text TEXT,
    confidence DECIMAL(3,2),
    error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for status filtering (used by status polling)
CREATE INDEX idx_tender_parse_status ON tender_parse_results(status);

-- Index for tender_id lookup
CREATE INDEX idx_tender_parse_tender_id ON tender_parse_results(tender_id);

-- Enable RLS
ALTER TABLE tender_parse_results ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own tender parse results (via tender ownership)
CREATE POLICY "Allow users to view own tender parses"
    ON tender_parse_results FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM contracts
            WHERE contracts.id = tender_parse_results.tender_id
            AND contracts.created_by = auth.uid()
        )
    );

-- Policy: Users can create their own tender parse results
CREATE POLICY "Allow users to create own tender parses"
    ON tender_parse_results FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM contracts
            WHERE contracts.id = tender_parse_results.tender_id
            AND contracts.created_by = auth.uid()
        )
    );

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tender_parse_results_updated_at
    BEFORE UPDATE ON tender_parse_results
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
