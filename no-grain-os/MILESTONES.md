# NO GRAIN OS — Milestones

**Última atualização:** 2026-06-30  
**Versão:** 3.0  
**Ambiente:** VPS `2.24.201.246` | Backend :8000 | Frontend :3000

---

## FASE 1 — Motor de Ingestão

### M1 — Ingestão WhatsApp + Gmail ✅
**Entregue:** 2026-06-inicial

**O que foi criado:**
- `routers/webhook_evolution.py` — endpoint `POST /webhook/evolution` recebe eventos da Evolution API (Baileys)
- `routers/webhook_gmail.py` — polling manual Gmail via `POST /webhook/gmail/poll`
- `services/openai_service.py` — extração estruturada com GPT-4o-mini (Structured Outputs)
- `services/supabase_writer.py` — insere cotações em `painel_fretes`
- `services/gmail_service.py` — polling inbox+spam, cache de IDs processados
- `models/schemas.py` — `CargaLogisticaSchema` Pydantic com 20+ campos
- Agendador APScheduler: Gmail a cada 1 minuto
- **Tabela Supabase:** `painel_fretes`

---

### M2 — Torre de Controle v1 ✅
**O que foi criado:**
- `frontend-torre/app/page.tsx` — Torre de Controle com source cards, tabela de cotações
- `frontend-torre/app/api/fretes/route.ts` — proxy para `/fretes`
- `services/sheets_reader.py` — lê aba "Carregamentos" do Google Sheets (Ongo) readonly
- `services/supabase_reader.py` — lê `painel_fretes`
- `routers/fretes.py` — `GET /fretes` fusão Sheets + Supabase

---

### M4 — Dados Fiéis ✅
**SQL:** `backend/m4_dados_fieis.sql`

**O que foi criado:**
- `services/domain_map.py` — mapeamento grupo WhatsApp → cliente/portal
- `services/location_parser.py` — extrai coordenadas GPS de textos
- Novas colunas em `painel_fretes`: `origem_localidade`, `destino_localidade`, `coords_coleta`, `cadencia_diaria`, `prazo_limite_resposta`, `sem_prazo`, `id_ongo`
- System prompt OpenAI expandido com dicionário de abreviações MT + 11 regras de extração

---

## FASE 2 — Precificador Flash Pro

### M3 (Fase 2) — Calculadora de Rotas ✅
**O que foi criado:**
- `services/qualp_service.py` — integração QualP V4 API com cache-aside no Supabase
- `services/antt_service.py` — piso ANTT (CCD/CCF), Portaria SUROC Nº 04/2026
- `routers/precificar.py` — `POST /api/precificar/` + `/rag` + `/sync-antt`
- `frontend-torre/app/torre/calcular/[id]/page.tsx` — workspace com mapa Leaflet, cards de resultado
- `components/MapaRota.tsx` — mapa interativo com polyline e marcadores de pedágio
- **Tabelas Supabase:** `antt_coeficientes`, `qualp_cache` (maplogis_cache)

---

### M6 — Gaveta de Detalhes + Motor Fiscal ✅
**SQL:** `backend/m6_status_constraint.sql`

**O que foi criado:**
- Gaveta lateral `CotacaoDrawer` com dois painéis: dados brutos + cálculo fiscal
- Motor ICMS/ISSQN automático por rota
- Mapa CartoDB Positron no drawer
- `PATCH /cotacoes/{id}/calcular` — grava distância, pedágio, ANTT
- `PATCH /cotacoes/{id}/preco` — salva preço proposto, auto-transição para COTACAO_FILIAL / APROV_DIRETORIA
- `PATCH /cotacoes/{id}/dados` — edição humana de campos texto
- `Copiar Dados Brutos` com seção CALCULO + AUDITORIA

---

### M7 — Funil de Status ✅
**SQL:** `backend/m7_funil.sql`

**O que foi criado:**
- `StatusDropdown` — dropdown de 8 status com auto-transições
- `PATCH /cotacoes/{id}/status` — atualização de status com validação
- 8 status: RECEBIDA → CALCULADA → PENDENTE → COTACAO_FILIAL / APROV_DIRETORIA → RESPONDIDA / GANHA / PERDIDA
- Regra: margem < `MARGEM_MINIMA_PCT` → APROV_DIRETORIA, senão → COTACAO_FILIAL

---

### M5 — Cards KPI Filtráveis + Radar WhatsApp ✅
**SQL:** `backend/milestones/m5_whatsapp_timeline.sql`

**O que foi criado:**
- **Cards KPI clicáveis:** "Cotações Recebidas" (limpa filtros), "Pendentes" (toggle), "Ganhas" (toggle)
- Ícone do fonte card WhatsApp alterado para `Radio` + label "Radar WhatsApp"
- `RadarWhatsAppTimeline` — gaveta lateral com feed de avisos de mercado
- `routers/whatsapp_timeline.py` — `GET /api/whatsapp/timeline?tipo=aviso&limit=50`
- `services/timeline_writer.py` — salva mensagens em `whatsapp_timeline`
- `frontend-torre/app/api/whatsapp/timeline/route.ts` — proxy Next.js
- **Tabela Supabase:** `whatsapp_timeline` (id, texto, classificacao, frete_id, criado_em, remetente, grupo_nome)
- Classificação automática: cotação com origem+destino → `painel_fretes`; sem rota → timeline `aviso`

---

### M8 — RAG Memória Dupla ✅
**SQL:** `backend/precificador_migration.sql` (inclui `historico_fechamentos` + RPC `buscar_fretes_similares`)

**O que foi criado:**
- `services/rag_service.py` — `buscar_historico_similar()` + `indexar_fechamento()`
- Auto-indexação: cotação GANHA/RESPONDIDA → `asyncio.create_task(indexar_fechamento(...))` sem bloquear response
- Embedding: OpenAI `text-embedding-3-small` (VECTOR 1536) + cosine similarity via pgvector
- `POST /api/precificar/rag` — busca top-5 fechamentos similares dos últimos 30 dias
- Painel "Inteligência de Mercado" na sidebar da calculadora:
  - Média de preço dos últimos 30 dias
  - Alerta "Você cotou esta rota há X dias por R$ Y/ton" (similaridade ≥ 85%)
  - Top 3 fechamentos históricos
- **Tabela Supabase:** `historico_fechamentos` + índice ivfflat + RPC `buscar_fretes_similares`

---

## FIXES E MELHORIAS PÓS-DEPLOY (2026-06-26)

### Fix WhatsApp — Reconexão + Configuração ✅
- Evolution API v1.8.6: instância `octamove` recriada (sessão expirada)
- `groups_ignore` corrigido para `false` (padrão ao criar = `true`, bloqueava todos os grupos)
- Webhook reconfigurado: `POST http://2.24.201.246:8000/webhook/evolution` evento `MESSAGES_UPSERT`

### Fix Classificador — Determinismo ✅
**Problema:** GPT-4o-mini retorna `nivel_confianca` de forma não-determinística — mesma mensagem ora `alto`, ora `baixo`.  
**Fix:** Critério de cotação mudado para `origem != "Não Especificado" AND destino != "Não Especificado"` (ignora nivel_confianca).

### Melhoria — Múltiplos Grupos ✅
- `GRUPOS_PERMITIDOS` virou dict `{jid: nome}`:
  ```python
  "120363410106462149@g.us": "Teste Fretes"
  "120363161423451430@g.us": "COA - Central Agrícola"
  ```
- Para adicionar grupo: incluir entrada no dict em `webhook_evolution.py`

### Melhoria — Timestamp na Tabela ✅
- Coluna "Recebida / SLA" na tabela de cotações mostra:
  - Horário exato: `26/06 14:54`
  - SLA relativo: `há 3 min` (verde/âmbar/vermelho)

### Melhoria — Origem do Grupo no Radar ✅
**SQL necessário:**
```sql
ALTER TABLE whatsapp_timeline ADD COLUMN IF NOT EXISTS grupo_nome text;
NOTIFY pgrst, 'reload schema';
```
- Cada mensagem no Radar WhatsApp mostra badge com nome do grupo de origem
- `timeline_writer.py` aceita parâmetro `grupo_nome`

---

---

## FASE 3 — Trizy BID (Ingestão direta marketplace)

### M9 — Trizy BID como fonte de ingestão ✅
**Entregue:** 2026-06-30

**Contexto:** Trizy é um marketplace B2B de fretes (embarcador × transportadora). Os BIDs são cotações abertas para disputar em rodadas com prazo, preço de referência e detalhes de rota.

**Scraper local (`scrapers/trizy/trizy_extractor.py` v5) — roda no notebook via Task Scheduler:**
- REST direto: `GET /bid/transportadora/cotacao-frete` (lista) + `/visualizar/{negociacaoId}` (detalhe)
- Auth: `trizy_access_token` cookie salvo em `tokens/trizy_cookies_scrapling.json`
- **Auto-retry 401 inline:** bloco de erro 401 chama `renew_token()` que dispara `StealthyFetcher.async_fetch` headless com `solve_cloudflare=True` para renovar a sessão sem intervenção manual
- **`parse_endereco()`:** extrai cidade/UF do campo `endereco` da API (`"S/L, S/N S/C - S/B, Itaituba - PA"` → `Itaituba/PA`). O campo `local` contém apenas o nome do ponto (ex: `"UNIZ ARMAZEM"`)
- **`upsert_smart()`:** insere novos como `status_crm='Novo'`, atualiza existentes sem sobrescrever `USER_FIELDS = {status_crm, valor_proposto_ton, observacao_interna}`
- Gera links Google Maps com ponto + cidade + estado para geocodificação precisa

**Tabela Supabase:** `octamove_extracao_trizy`
- Campos chave: `id_frete_externo`, `empresa_embarcadora`, `cnpj_embarcadora`, `origem_cidade`, `origem_estado`, `destino_cidade`, `destino_estado`, `produto`, `peso_toneladas`, `distancia_km`, `cadencia_toneladas`, `preco_por_tonelada`, `possui_pedagio`, `pedagio_incluso`, `pedagio_valor_por_eixo`, `prazo_limite_resposta`, `status_interno`, `status_crm`, `localizacao_origem`, `localizacao_origem_link`, `observacao_origem`, `entidade_origem`, `localizacao_destino`, `localizacao_destino_link`, `observacao_destino`, `entidade_destino`, `observacao_geral`

**Torre de Controle — novos recursos:**
- Card "Trizy BID" com contador de cotações ativas
- Radar: origem/destino mostram `Cidade/UF` (não mais nome de ponto)
- `app/api/trizy/cotacoes/route.ts` lê Supabase diretamente (não passa pelo backend)
- Prioridade de exibição: `origem_cidade/UF` → texto completo → nome do ponto
- Drawer Auditoria reestruturado em 3 seções:
  - **Identificação:** BID Nº, Status Trizy, Preço Ref., Cond. Pagamento, ICMS
  - **Pedágio:** Tem Pedágio, Incluso no Frete, R$/Eixo
  - **Localização:** Local Coleta, Entidade Orig., Local Descarga, Entidade Dest. + links Maps
- Calculadora: exibe links Maps do Trizy + alerta quando origem/destino não geocodificável por QualP

**Armadilhas identificadas:**
- `SUPABASE_SERVICE_KEY` ausente do `.env.local` VPS → API retorna 0 cotações (fix: adicionar ao `.env.local` e `pm2 restart --update-env`)
- Token Trizy: JWT válido mas sessão server-side invalidada → HTTP 401. Solução: auto-retry com Scrapling
- Campo `local` da API = nome do ponto (ex: "UNIZ ARMAZEM"), cidade/UF está no campo `endereco` (`"S/L, S/N S/C - S/B, City - UF"`)
- VPS não tem repositório git — arquivos enviados diretamente; deploy = `npm run build` + `pm2 restart --update-env`

---

## FASE 4 — MVP Torre de Controle (Plano de Engenharia 2026-07-01)

### M12 — Saneamento Status/SLA/Tipografia Radar ✅
**Entregue:** 2026-07-01

**Causa raiz do bug de "dropdown revertendo":** cotações Trizy usam `id_frete_externo` como `id` no frontend, mas `PATCH /cotacoes/{id}/status` sempre fazia `UPDATE painel_fretes WHERE id=...`. Para linhas Trizy isso dá 404 (tabela errada) → PATCH falha → estado local nunca atualiza → próximo poll (10s) restaura o valor antigo, dando a impressão de "reverter".

**O que foi corrigido:**
- `types/carga.ts` — `StatusCotacao` sem duplicidade de caixa (`sem_resposta`/`respondida` minúsculos removidos, eram dead code nunca escrito por nenhum writer); adicionado `COTADO_AGUARDANDO` (pré-requisito de M13)
- `backend/routers/cotacoes.py` — `atualizar_status()` agora faz fallback: se `painel_fretes` 404, tenta `octamove_extracao_trizy` por `id_frete_externo` + coluna `status_crm`. Persistência Trizy corrigida na origem.
- `app/api/trizy/cotacoes/route.ts` — normaliza `status_crm='Novo'` (default do extrator, fora do enum) → `RECEBIDA`
- `app/page.tsx`:
  - `updateStatus()` agora sincroniza `trizyCotacoes` (antes só `fretes`) + trata falha de rede/HTTP com toast
  - `CountdownSLA`: limiares ajustados para >2h verde / <2h laranja (cobre "<1h") / <15min vermelho `animate-pulse` (mecanismo `useEffect`+`setInterval` 1s já existia, corrigido o breakpoint)
  - ID Trizy na tabela do Radar: `text-sm font-bold text-orange-500 tracking-wide`
- **Validado:** `tsc --noEmit` limpo (único erro remanescente é `leaflet` ausente do `node_modules`, pré-existente, fora do escopo — pertence a M13/MapaRota.tsx) + `eslint` sem erros novos (warnings pré-existentes de `react-hooks/set-state-in-effect` em código não tocado)

**Armadilha para M13:** se `painel_fretes` tiver `CHECK constraint` no `status` (ver `m6_status_constraint.sql`), gravar `COTADO_AGUARDANDO` vai 500 até rodar migration adicionando o valor — mesmo padrão do trap já documentado abaixo.

---

### M13 — Pipeline "Cotado Aguardando" + Export Geolocalizado (Backlog)
- Status `COTADO_AGUARDANDO` setado ao salvar preço comercial (`PATCH /cotacoes/{id}/preco`) — precisa migration de constraint em `painel_fretes` antes
- Nova aba/card "Cotado Aguardando Resposta" — oculto dos radares ativos, 100% editável
- `buildDadosBrutos()` em `app/page.tsx` — incluir `origem_maps_link`/`destino_maps_link` no template de cópia (já existem no tipo, só não estão no template atual)

### M14 — Calculadora RAG + Mapa + Saneamento Endereço (Backlog)
- Corrigir `ragData` do `POST /api/precificar/rag` no workspace `[id]/page.tsx`
- Extração automática de endereço limpo a partir de links Maps/texto ruidoso → `origemInput`/`destinoInput` (evitar quebra da Regex QualP V4)
- Tipografia do workspace: `text-sm` / `text-base font-semibold`
- `TileLayer` Leaflet de alta definição no `MapaRota.tsx` — **depende de `npm install` resolver o conflito de peer deps `@tremor/react` (React 18) vs `react@19.2.4` já presente no projeto** (ver Armadilhas)

### M15 — Módulo Ongo Planilha + Aderência + RAG Diário (Backlog)
- View em modo planilha ao clicar no card Ongo (187 registros), com filtros e agrupamento por município
- Painel de totais: TOTAL DE LOTES, TOTAL CADENCIA, TOTAL ACIONADO, Aderência % = Acionado/Cadência×100
- Rotina de fechamento diário → compacta em histórico consolidado para alimentar RAG da calculadora

### M16 — Ingestão Avançada: Gmail Anti-Ruído + Triagem WhatsApp (Backlog)
- Filtro classificador Gmail (RAG de triagem) — só Cotações de Frete e Liberações de Embarque
- Card WhatsApp com volumetria tipificada: `Total X — Informações Y — Cotações Z`
- Parser de "Embarque Liberado" (BTG/Ricelly) → card/campo "Liberações" estruturado
- Botão `[Tratado]` no Radar WhatsApp — oculta da fila visual, mantém arquivado no banco

---

## PRÓXIMOS MILESTONES (Backlog)

| # | Milestone | Descrição | Prioridade |
|---|-----------|-----------|------------|
| M10 | Trizy FASE 2 — POST Lance | Botão "Fazer Oferta" na calculadora: `POST /bid/transportadora/cotacao-frete/{negociacaoId}/lance` | Alta |
| M10 | Trizy — Token auto-renovação Task Scheduler | Agendar `trizy_login.py` diário para manter sessão ativa | Alta |
| M10 | Trizy — Alerta WhatsApp | Enviar mensagem via Evolution API quando novo BID chega com produto/rota de interesse | Alta |
| M11 | Trizy — CRM N8N | Workflow N8N que lê `status_crm` e dispara ações (resposta, acompanhamento) | Média |
| — | Ongo Task Scheduler | Rodar `extract_ongo.py` automaticamente às 23:55 via Windows Task Scheduler | Alta |
| — | Ongo Aba Aderência | Implementar aba "Aderência Transportadoras" no `extract_ongo.py` | Média |
| — | Adicionar grupos de frete reais | Incluir grupos como "Fretes MT", "APCAM FRETES", "Fretes Rondonópolis" no `GRUPOS_PERMITIDOS` | Média |
| — | Popular `historico_fechamentos` | Importar fechamentos históricos reais para ativar RAG com dados reais | Média |
| — | Notificações push | Alerta sonoro/visual quando nova cotação chega na Torre | Baixa |
| — | CRM por embarcador | Histórico de cotações, taxa de ganho, ticket médio por cliente | Baixa |

---

## ARMADILHAS CONHECIDAS

| Problema | Causa | Solução |
|---|---|---|
| Novo valor de `status` causa 500 | Constraint `painel_fretes_status_check` no Supabase | Rodar `m6_status_constraint.sql` com o novo valor |
| `systemd nograin.service` conflita porta 8000 | Instalação antiga em `/opt/no-grain-os/` | `systemctl stop nograin && systemctl disable nograin` |
| `npm install` falha na VPS | Conflito peer deps React 19 + tremor | Usar `--legacy-peer-deps` |
| Sheets 403 | Scope indevido | Sempre `spreadsheets.readonly` |
| Evolution `groups_ignore: true` | Padrão ao criar nova instância | Sempre setar `groups_ignore: false` após criar |
| GPT-4o-mini `nivel_confianca` não-determinístico | Temperatura do modelo | Não usar `nivel_confianca` como gate de cotação |
