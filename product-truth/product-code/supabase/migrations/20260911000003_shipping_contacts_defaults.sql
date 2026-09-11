-- F054: owner-private address book and last successful shipment autofill.
-- Public visitors must never receive these contacts or shipment payloads.
ALTER TABLE public.shipping_requests ADD COLUMN IF NOT EXISTS request_payload jsonb;
CREATE TABLE IF NOT EXISTS public.shipping_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  contact jsonb NOT NULL CHECK (jsonb_typeof(contact) = 'object'),
  fingerprint text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(created_by, fingerprint)
);
ALTER TABLE public.shipping_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipping_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.shipping_contacts TO service_role;
COMMENT ON COLUMN public.shipping_requests.request_payload IS 'Validated contact snapshot for owner-only last successful shipment autofill; excluded from recent-list API.';
