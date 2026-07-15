-- P4.2-S0: close direct access to AI configuration control-plane data and
-- prevent provider credentials from being copied into immutable version history.
--
-- This migration intentionally keeps the current configs.value API key in place
-- for runtime compatibility. It only removes api_key from historical snapshots;
-- moving live credentials to a secret reference is a separate migration.

CREATE OR REPLACE FUNCTION public.record_config_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_history_value JSONB;
BEGIN
  IF OLD.value IS DISTINCT FROM NEW.value OR OLD.status IS DISTINCT FROM NEW.status THEN
    v_history_value := CASE
      WHEN OLD.type = 'AI_CONFIG'::public.config_type
        OR NEW.type = 'AI_CONFIG'::public.config_type
      THEN COALESCE(NEW.value, '{}'::JSONB) - ARRAY[
        'api_key', 'apiKey', 'access_token', 'accessToken',
        'refresh_token', 'refreshToken', 'authorization',
        'client_secret', 'clientSecret', 'password', 'secret', 'token'
      ]::TEXT[]
      ELSE NEW.value
    END;

    INSERT INTO public.config_versions (
      config_id,
      version,
      value,
      status,
      created_by,
      created_at
    ) VALUES (
      NEW.id,
      NEW.version,
      v_history_value,
      NEW.status,
      NEW.created_by,
      NEW.updated_at
    );

    NEW.version := NEW.version + 1;
  END IF;

  RETURN NEW;
END;
$$;

-- Existing AI provider history may already contain plaintext credentials.
-- Scrub only snapshots whose owning configuration is an AI_CONFIG.
UPDATE public.config_versions AS history
SET value = history.value - ARRAY[
  'api_key', 'apiKey', 'access_token', 'accessToken',
  'refresh_token', 'refreshToken', 'authorization',
  'client_secret', 'clientSecret', 'password', 'secret', 'token'
]::TEXT[]
FROM public.configs AS config
WHERE config.id = history.config_id
  AND config.type = 'AI_CONFIG'::public.config_type
  AND history.value ?| ARRAY[
    'api_key', 'apiKey', 'access_token', 'accessToken',
    'refresh_token', 'refreshToken', 'authorization',
    'client_secret', 'clientSecret', 'password', 'secret', 'token'
  ]::TEXT[];

-- RLS alone is not the authorization boundary for these service-role-backed
-- routes. Remove Data API table privileges from browser-facing roles.
REVOKE ALL PRIVILEGES ON TABLE public.configs FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.configs FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.configs FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.configs FROM service_role;

REVOKE ALL PRIVILEGES ON TABLE public.config_versions FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.config_versions FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.config_versions FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.config_versions FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.configs TO service_role;
GRANT SELECT, INSERT ON TABLE public.config_versions TO service_role;

-- Both functions are invoked only through server-side supabaseAdmin callers.
-- Keep their signatures and behavior unchanged, but remove default/public Data
-- API execution and grant the minimum compatible caller role explicitly.
REVOKE ALL PRIVILEGES ON FUNCTION public.exec_sql(TEXT) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.exec_sql(TEXT) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.exec_sql(TEXT) FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.exec_sql(TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.exec_sql(TEXT) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.claim_contract_analysis_job(TEXT, INTERVAL) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.claim_contract_analysis_job(TEXT, INTERVAL) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.claim_contract_analysis_job(TEXT, INTERVAL) FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.claim_contract_analysis_job(TEXT, INTERVAL) FROM service_role;
GRANT EXECUTE ON FUNCTION public.claim_contract_analysis_job(TEXT, INTERVAL) TO service_role;
