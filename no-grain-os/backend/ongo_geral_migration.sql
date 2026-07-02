-- NO GRAIN OS - Migracao: M15 Dashboard Ongo Cargas (Frete Geral Ongo)
-- Rodar no Supabase SQL Editor

-- Cargas Ongo (sincronizado a cada ciclo de extract_ongo.py)
CREATE TABLE IF NOT EXISTS public.cargas_ongo (
  id                  BIGSERIAL      PRIMARY KEY,
  link_id_carga       TEXT           UNIQUE NOT NULL,
  data_captura        TIMESTAMPTZ    NOT NULL,
  empresa             TEXT,
  municipio_origem    TEXT,
  terminal_origem     TEXT,
  origem              TEXT,
  destino             TEXT,
  produto             TEXT,
  quantidade_kg       NUMERIC,
  saldo_restante_kg   NUMERIC,
  valor_proposto_ton  NUMERIC,
  status              TEXT,
  criado_em           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cargas_ongo_status    ON public.cargas_ongo (status);
CREATE INDEX IF NOT EXISTS idx_cargas_ongo_municipio ON public.cargas_ongo (municipio_origem);
CREATE INDEX IF NOT EXISTS idx_cargas_ongo_empresa   ON public.cargas_ongo (empresa);
CREATE INDEX IF NOT EXISTS idx_cargas_ongo_captura   ON public.cargas_ongo (data_captura DESC);

ALTER TABLE public.cargas_ongo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Leitura publica de cargas_ongo" ON public.cargas_ongo FOR SELECT USING (true);

-- Nota: o fechamento diario (23:55) nao usa tabela propria - grava direto em
-- historico_fechamentos (ver precificador_migration.sql), reaproveitando o
-- mesmo RAG do precificador para sugestao de preco por similaridade de rota.

-- Notificar PostgREST para recarregar schema
NOTIFY pgrst, 'reload schema';
