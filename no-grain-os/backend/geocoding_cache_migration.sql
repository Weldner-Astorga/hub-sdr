-- Cache de geocoding (Nominatim/OpenStreetMap) para textos de endereco sem coordenada
-- embutida no link do Maps. Rodar uma vez no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.geocoding_cache (
  id BIGSERIAL PRIMARY KEY,
  endereco_normalizado TEXT UNIQUE NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  provider TEXT NOT NULL DEFAULT 'nominatim',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
