-- ============================================================
-- Hub SDR — Supabase Schema com suporte a pgvector (RAG)
-- ============================================================

-- Habilitar extensão pgvector para embeddings RAG
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- TABELA: leads
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome        TEXT NOT NULL,
  email       TEXT UNIQUE,
  telefone    TEXT,
  empresa     TEXT,
  cargo       TEXT,
  origem      TEXT,                        -- ex: 'linkedin', 'site', 'evento'
  status      TEXT DEFAULT 'novo',        -- novo | qualificado | descartado | convertido
  score       INT  DEFAULT 0,
  notas       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Índice para buscas por status e origem
CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_origem  ON leads (origem);
CREATE INDEX IF NOT EXISTS idx_leads_email   ON leads (email);

-- ============================================================
-- TABELA: interacoes (histórico de contatos com leads)
-- ============================================================
CREATE TABLE IF NOT EXISTS interacoes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,               -- email | ligacao | reuniao | mensagem
  conteudo    TEXT,
  resultado   TEXT,                        -- sem_resposta | agendado | negado | followup
  realizado_em TIMESTAMPTZ DEFAULT now(),
  criado_por  TEXT                         -- usuário/agente responsável
);

CREATE INDEX IF NOT EXISTS idx_interacoes_lead_id ON interacoes (lead_id);

-- ============================================================
-- TABELA: documentos (base de conhecimento para RAG)
-- ============================================================
CREATE TABLE IF NOT EXISTS documentos (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo      TEXT NOT NULL,
  conteudo    TEXT NOT NULL,
  fonte       TEXT,                        -- ex: 'pdf', 'url', 'manual'
  embedding   VECTOR(1536),               -- dimensão para text-embedding-3-small (OpenAI)
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Índice HNSW para busca vetorial eficiente (RAG)
CREATE INDEX IF NOT EXISTS idx_documentos_embedding
  ON documentos
  USING hnsw (embedding vector_cosine_ops);

-- ============================================================
-- TABELA: campanhas (sequências de outbound)
-- ============================================================
CREATE TABLE IF NOT EXISTS campanhas (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  status      TEXT DEFAULT 'rascunho',    -- rascunho | ativa | pausada | encerrada
  inicio      TIMESTAMPTZ,
  fim         TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- TABELA: campanha_leads (relação N:N entre campanhas e leads)
-- ============================================================
CREATE TABLE IF NOT EXISTS campanha_leads (
  campanha_id UUID NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,
  lead_id     UUID NOT NULL REFERENCES leads(id)     ON DELETE CASCADE,
  etapa       INT  DEFAULT 1,
  adicionado_em TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (campanha_id, lead_id)
);

-- ============================================================
-- FUNÇÃO: busca semântica por similaridade (RAG)
-- ============================================================
CREATE OR REPLACE FUNCTION buscar_documentos(
  query_embedding VECTOR(1536),
  limite          INT DEFAULT 5
)
RETURNS TABLE (
  id        UUID,
  titulo    TEXT,
  conteudo  TEXT,
  fonte     TEXT,
  score     FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    id,
    titulo,
    conteudo,
    fonte,
    1 - (embedding <=> query_embedding) AS score
  FROM documentos
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT limite;
$$;

-- ============================================================
-- TRIGGER: atualizar updated_at automaticamente em leads
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
