-- NO GRAIN OS - Migracao M50: Fechamento de lote -> historico (Modulo Liberacoes)
-- Camada 4 do modelo de dados de 5 camadas (ver PRD.md 9.7 / MILESTONES.md FASE 11).
-- Rodar comando por comando no SQL Editor do Supabase (nao colar o arquivo inteiro
-- de uma vez - achado conhecido do M40, paste multi-statement corrompe intermitente).

CREATE TABLE IF NOT EXISTS public.execucoes_lote (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte TEXT NOT NULL,
  id_externo TEXT NOT NULL,
  cliente TEXT,
  origem TEXT,
  destino TEXT,
  produto TEXT,
  volume_total_kg NUMERIC,
  saldo_final_kg NUMERIC,
  valor_tonelada NUMERIC,
  frete_motorista_ton NUMERIC,
  margem_ton NUMERIC,
  status_final TEXT NOT NULL,
  documentos_ids UUID[],
  fechado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fonte, id_externo)
);

CREATE INDEX IF NOT EXISTS idx_execucoes_lote_cliente ON public.execucoes_lote(cliente);

NOTIFY pgrst, 'reload schema';
