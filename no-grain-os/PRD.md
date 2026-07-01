# NO GRAIN OS — Product Requirements Document (PRD)

**Versão:** 3.0  
**Data:** 2026-06-30  
**Dono:** Weldner Astorga / Octamove  
**Email:** edastorga0@gmail.com

---

## 1. Visão do Produto

**NO GRAIN OS** é um motor de inteligência operacional para a logística de grãos do Centro-Oeste brasileiro.

Captura automaticamente cotações de frete de múltiplas fontes (WhatsApp, Gmail, Ongo, Trizy BID), extrai dados estruturados com IA e centraliza tudo numa Torre de Controle em tempo real — com precificador integrado, histórico vetorial (RAG) e funil de status.

**Problema resolvido:** O time comercial perde cotações porque elas chegam espalhadas em dezenas de grupos de WhatsApp, e-mails e marketplaces B2B, sem estrutura, sem histórico de preços e sem SLA visual.

---

## 2. Usuários

| Perfil | Uso |
|--------|-----|
| Comercial | Recebe cotações, precifica, responde, acompanha funil |
| Diretoria | Aprova cotações acima da margem mínima |
| Operacional | Acompanha fretes confirmados (GANHA) |

---

## 3. Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Backend | FastAPI + APScheduler + uvicorn |
| IA extração | OpenAI GPT-4o-mini (Structured Outputs) |
| IA embeddings | OpenAI text-embedding-3-small (VECTOR 1536) |
| Banco | Supabase (PostgreSQL + pgvector) |
| Email | Gmail API (OAuth2) — octamoveai@gmail.com |
| WhatsApp | Evolution API v1.8.6 (Baileys) |
| Planilha | Google Sheets API readonly (Ongo Cargas) |
| Frontend | Next.js 16 (App Router) + Tailwind v4 |
| Deploy | PM2 na VPS Hostinger 2.24.201.246 |

---

## 4. Arquitetura de Dados

### Tabelas Supabase

```
painel_fretes              — cotações estruturadas (WhatsApp + Gmail)
whatsapp_timeline          — feed completo de mensagens dos grupos (cotação + aviso)
qualp_cache                — cache 24h de rotas QualP V4
antt_coeficientes          — coeficientes CCD/CCF ANTT por tipo de veículo
historico_fechamentos      — embeddings pgvector de cotações GANHA/RESPONDIDA (RAG)
octamove_extracao_trizy    — BIDs do marketplace Trizy (extrator local no notebook)
```

### Fluxo de Ingestão

```
WhatsApp (grupo autorizado)
    → Evolution API webhook → POST /webhook/evolution
    → GPT-4o-mini extrai origem/destino/produto
    → tem rota?  sim → painel_fretes (RECEBIDA) + whatsapp_timeline (cotacao)
                 não → whatsapp_timeline (aviso) apenas

Gmail (octamoveai@gmail.com)
    → APScheduler 1min → gmail_service.py
    → GPT-4o-mini → painel_fretes

Ongo Cargas (planilha)
    → Google Sheets readonly → GET /fretes (merge) → Torre

Trizy BID (marketplace B2B) — LOCAL no notebook Windows
    → Task Scheduler → trizy_extractor.py v5
    → GET /bid/transportadora/cotacao-frete (lista 100 BIDs)
    → GET /visualizar/{negociacaoId} (detalhe por BID)
    → parse_endereco(): campo 'endereco' → cidade/UF real
    → upsert_smart() → octamove_extracao_trizy (Supabase)
    → Torre lê via /api/trizy/cotacoes (Next.js → Supabase direto)
    → Auto-retry 401: Scrapling headless headless + Turnstile resolve
```

### Fluxo de Precificação

```
Torre → clica cotação → Workspace Calculadora
    → POST /api/precificar/ → QualP V4 (cache) → distância + pedágios + ANTT
    → POST /api/precificar/rag → pgvector → top-5 similares 30d
    → comercial define preço → PATCH /cotacoes/{id}/preco
    → status: COTACAO_FILIAL ou APROV_DIRETORIA (se margem < limiar)
    → GANHA/RESPONDIDA → indexar_fechamento() em background
```

---

## 5. Funcionalidades Entregues

### Torre de Controle
- Cards KPI clicáveis com filtros (Total / Pendentes / Ganhas)
- Tabela: Cliente, Rota, Produto/R$/t, Volume, Recebida/SLA, Status, Ações
- Coluna "Recebida / SLA": horário exato + tempo relativo (verde/âmbar/vermelho)
- Source cards: Ongo / Radar WhatsApp / Gmail / Frete Geral / **Trizy BID**
- Polling automático 5s
- StatusDropdown com 8 transições
- **Trizy BID (2026-06-30):**
  - Card Trizy BID com contador de BIDs ativos
  - Radar mostra `Cidade/UF` reais (não nome de ponto de coleta)
  - Drawer Auditoria: seções Identificação / Pedágio / Localização (Trizy)
  - Links Google Maps por BID (ponto + cidade + estado)
  - Calculadora: link Maps clicável + alerta se origem/destino não geocodificável

### Radar WhatsApp
- Gaveta lateral com feed de avisos de mercado
- Badge de origem do grupo por mensagem
- Classificação automática: cotação (origem+destino identificados) vs aviso
- Suporte a múltiplos grupos com nomes mapeados

### Calculadora de Rotas
- Distância via QualP V4 (cache-aside 24h)
- Pedágios por eixo (7E Bitrem / 9E Rodotrem)
- Piso ANTT automático (Portaria SUROC Nº 04/2026)
- Mapa Leaflet com polyline e marcadores de pedágio
- Painel "Inteligência de Mercado" (RAG top-5 últimos 30 dias)
- Ações: Salvar Preço, Copiar WhatsApp, Enviar Aprovação, Copiar Link

### Funil de Status (8 estágios)
```
RECEBIDA → CALCULADA → PENDENTE → COTACAO_FILIAL / APROV_DIRETORIA → RESPONDIDA / GANHA / PERDIDA
```
- Transição automática por margem vs ANTT
- Edição manual de dados brutos

### RAG — Inteligência de Mercado
- Auto-indexação ao fechar cotação (GANHA/RESPONDIDA) em background
- Busca semântica cosine similarity top-5 / 30 dias
- Painel: média de preço, alerta "cotou X dias atrás", lista de fechamentos similares

---

## 6. Configurações de Produção

### Grupos WhatsApp Autorizados
`backend/routers/webhook_evolution.py`:
```python
GRUPOS_PERMITIDOS: dict[str, str] = {
    "120363410106462149@g.us": "Teste Fretes",
    "120363161423451430@g.us": "COA - Central Agrícola",
    # Adicionar novos grupos aqui
}
```

### Margem Mínima
`backend/core/config.py`:
```python
MARGEM_MINIMA_PCT: float = 5.0  # abaixo → APROV_DIRETORIA
```

### Variáveis de Ambiente
```
OPENAI_API_KEY=...
SUPABASE_URL=https://htktdilkbdkqtvhthont.supabase.co
SUPABASE_KEY=...
QUALP_TOKEN=...
BACKEND_URL=http://localhost:8000  # frontend-torre/.env.local
```

---

## 7. Deploy

```bash
python backend/deploy_vps.py
# Empacota → envia → pip install → npm build → pm2 restart
```

---

## 8. SQL Migrations

| Arquivo | Status | Descrição |
|---------|--------|-----------|
| `backend/m4_dados_fieis.sql` | ✅ | Colunas extras painel_fretes |
| `backend/m6_status_constraint.sql` | ✅ | Constraint de status |
| `backend/m7_funil.sql` | ✅ | Colunas do funil |
| `backend/milestones/m5_whatsapp_timeline.sql` | ✅ | Tabela whatsapp_timeline |
| `backend/precificador_migration.sql` | ✅ | antt_coeficientes, historico_fechamentos, RPC pgvector |
| Inline | ✅ | `ALTER TABLE whatsapp_timeline ADD COLUMN grupo_nome text` |

---

## 9. MVP Torre de Controle — Plano de Engenharia (2026-07-01)

Ver `MILESTONES.md` FASE 4 para detalhe técnico completo (M12–M16).

| # | Milestone | Status |
|---|-----------|--------|
| M12 | Saneamento Status/SLA/Tipografia Radar — fix raiz do dropdown revertendo (Trizy usava tabela errada no PATCH) | ✅ 2026-07-01 |
| M13 | Pipeline "Aguardando Resposta" (convive c/ roteamento por margem) + export geolocalizado (maps links no template de cópia) | ✅ 2026-07-01 |
| M14 | Calculadora: RAG lateral + saneamento de endereço + mapa HD (bloqueado por dep `leaflet`/`@tremor` — ver Armadilhas) | Backlog |
| M15 | Ongo: view planilha + métricas de Aderência % + fechamento diário RAG | Backlog |
| M16 | Gmail anti-ruído + triagem WhatsApp + card Liberações + botão `[Tratado]` | Backlog |

## 9.1 Backlog Priorizado (legado)

| Prioridade | Item |
|------------|------|
| Alta | Trizy FASE 2: POST lance via calculadora (`/bid/.../lance`) |
| Alta | Trizy: token auto-renovação via Task Scheduler diário |
| Alta | Trizy: alerta WhatsApp para novos BIDs de interesse |
| Alta | Ongo Task Scheduler automático às 23:55 |
| Média | Trizy CRM N8N: workflow por `status_crm` |
| Média | Ongo: aba Aderência Transportadoras no extrator |
| Média | Adicionar grupos reais de frete (APCAM, Fretes MT, etc.) |
| Média | Popular `historico_fechamentos` com dados históricos |
| Baixa | Notificações push / som na Torre ao receber cotação |
| Baixa | CRM por embarcador (taxa de ganho, ticket médio) |
| Baixa | App mobile PWA |

---

## 10. Armadilhas Conhecidas

| Problema | Causa | Solução |
|----------|-------|---------|
| Novo status causa 500 | Constraint `painel_fretes_status_check` | Atualizar via SQL Editor |
| `systemd nograin.service` conflita :8000 | Instalação antiga em `/opt/no-grain-os/` | `systemctl stop nograin && disable` |
| `npm install` falha na VPS | Conflito peer deps | `--legacy-peer-deps` |
| Sheets 403 | Scope indevido | Sempre `spreadsheets.readonly` |
| Evolution `groups_ignore: true` | Padrão ao criar instância | Setar `false` após criar |
| GPT-4o-mini `nivel_confianca` não-determinístico | Temperatura do modelo | Não usar como gate de cotação |
| `node_modules` sem `leaflet`/`@types/leaflet` instalados + conflito peer dep `@tremor/react` (React 18) vs `react@19.2.4` | `npm install` nunca rodado após adicionar `leaflet` ao `package.json`, ou rodado sem `--legacy-peer-deps` | Antes de M14: `npm install --legacy-peer-deps` (mesmo padrão já documentado para a VPS) |
| Novo valor de `status` (ex.: `COTADO_AGUARDANDO`) pode causar 500 | `CHECK constraint` em `painel_fretes.status` (`m6_status_constraint.sql`) só aceita os 8 valores originais | Rodar migration adicionando o valor ao constraint antes de gravar `COTADO_AGUARDANDO` diretamente |
| "Salvar Preço Proposto" falha silenciosamente pra cotações Trizy no Workspace | `PATCH /cotacoes/{id}/preco` só atualiza `painel_fretes` (coluna `id` é `uuid`); ids Trizy não são uuid | Aplicar o mesmo fallback Trizy que `/status` já tem (M12), mapeando pra coluna `valor_proposto_ton` |
