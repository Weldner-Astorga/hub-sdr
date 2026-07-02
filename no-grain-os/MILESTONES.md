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
- **Validado:** `tsc --noEmit` limpo (único erro remanescente é `leaflet` ausente do `node_modules`, pré-existente, fora do escopo — pertence a M14/MapaRota.tsx) + `eslint` sem erros novos (warnings pré-existentes de `react-hooks/set-state-in-effect` em código não tocado)

---

### M13 — Pipeline "Aguardando Resposta" + Export Geolocalizado ✅
**Entregue:** 2026-07-01

**Decisão de produto (confirmada com o usuário):** em vez de `COTADO_AGUARDANDO` substituir o roteamento por margem do M6/M7, ele **convive** com ele. O backend (`/cotacoes/{id}/preco`) continua calculando `COTACAO_FILIAL`/`APROV_DIRETORIA` normalmente — nada mudou lá. O que mudou é só a camada de visualização: um cluster de status "já cotado, aguardando cliente" (`COTACAO_FILIAL`, `APROV_DIRETORIA`, `RESPONDIDA`, `COTADO_AGUARDANDO`) agora sai do radar ativo por padrão.

**O que foi criado (`app/page.tsx`):**
- `STATUS_AGUARDANDO` (Set) — cluster dos 4 status acima
- `cotacoesVisiveis` — oculta o cluster do Radar por padrão; escape hatch: se o operador filtrar explicitamente por um desses status no dropdown "Status", eles voltam a aparecer
- Novo KPI card clicável "Aguardando Resposta" (grid 3→4 colunas) — toggle que mostra *só* o cluster, reaproveitando a mesma tabela + `CotacaoDrawer` já existentes (sem duplicar UI) — herda de graça o "Alterar Dados" e o input de preço já 100% editáveis
- `buildDadosBrutos()` — template reescrito: primeira linha é o ID puro (sem prefixo), acrescido `MAPS ORIGEM`/`MAPS DESTINO` (campos `origem_maps_link`/`destino_maps_link`, já existiam no tipo mas não eram lidos)

**Testado em produção (VPS, dados reais):**
- PATCH real setando `APROV_DIRETORIA` numa cotação → some do Radar ativo (82→80) e aparece no card "Aguardando Resposta" (0→2 — achou também 1 item pré-existente real em `RESPONDIDA` que já estava "escondido à vista" no radar antes desta fix)
- Clique no card abre a lista filtrada corretamente (confirmado via Puppeteer, screenshot)
- Bundle de produção confirmado com `MAPS ORIGEM`/`MAPS DESTINO`/`COTADO_AGUARDANDO` compilados
- Dado de teste restaurado ao estado original após validação

**Gap descoberto (backlog, não bloqueia M13):** `PATCH /cotacoes/{id}/preco` e `/calcular` **não têm** o mesmo fallback Trizy que `/status` recebeu no M12 — `painel_fretes.id` é `uuid`, então "Salvar Preço Proposto" no Workspace falha silenciosamente (500) para cotações Trizy. `/status` já funciona (path `RESPONDIDA` via "Copiar WhatsApp" cobre Trizy hoje). `/calcular` precisaria de colunas novas em `octamove_extracao_trizy` (não tem `pedagio_total_calc`/`antt_piso_por_ton`); `/preco` poderia mapear para a coluna `valor_proposto_ton` já existente.

### M14 — Hotfix Preço Trizy + Deps + RAG + Saneamento + Mapa ✅
**Entregue:** 2026-07-02

**1. Hotfix backlog (Preço Trizy):** generalizado o fallback do M12 — `_update_status_trizy`/`_update_status_trizy_sync` virou `_update_trizy`/`_update_trizy_sync` com `_TRIZY_FIELD_MAP` (`status→status_crm`, `preco_proposto→valor_proposto_ton`). `PATCH /cotacoes/{id}/preco` agora tenta `painel_fretes`; se 404 (id não é uuid), cai no fallback Trizy. Testado em produção: BID `#00067487` → preço R$185,50/t → margem 8,36% → `APROV_DIRETORIA` calculado e persistido corretamente; dado de teste restaurado via Supabase REST direto (`/preco` não tem rota para zerar o valor).

**2. Dependências do mapa:** `@tremor/react` estava em `package.json` mas **não é usado em lugar nenhum do código-fonte** — dependência morta que só existia pra colidir com `react@19.2.4` (ela exige React 18). Removida na raiz — sem `--legacy-peer-deps`, sem downgrade de nada. `npm install` limpo, `leaflet`/`@types/leaflet` finalmente instalados, `tsc --noEmit` e `next build` sem erros.

**3. RAG reativado — a causa raiz não era o frontend:** a condição de renderização (`ragLoading || (ragData && ragData.total > 0)`) já estava correta. O bug real era um **typo na função SQL `buscar_fretes_similares` já publicada no Supabase de produção** (`data_limi` em vez de `data_limite`, erro Postgres `42703`) — a versão ao vivo no banco tinha divergido do `precificador_migration.sql` local (que está correto). Sem acesso Postgres direto nem RPC genérica de exec SQL, e login automatizado no Supabase Studio via Puppeteer foi bloqueado por CAPTCHA anti-bot (não tentei contornar) — usuário rodou o `CREATE OR REPLACE FUNCTION` manualmente no SQL Editor. Confirmado via curl: erro desapareceu. Frontend também ganhou estados vazio/erro explícitos (antes: `total===0` não mostrava nada, parecia "quebrado" mesmo funcionando) e o `Date.now()` do render (flagged por `react-hooks/purity`) migrou pra um `ragAsOf` capturado no fetch.
- **Backlog real:** `historico_fechamentos` está vazio — RAG funciona mas não tem dados pra sugerir ainda (mesmo item já listado abaixo).

**4. Saneamento "Copiar Localização":** `sanitizeLocalizacao()` — detecta URL crua do Google Maps (usa `origem_localidade`/`destino_localidade` como fallback) e isola "Cidade/UF" do fim de texto ruidoso multi-vírgula (ex.: `"S/L, S/N S/C - S/B, Itaituba - PA"` → `"Itaituba/PA"`, mesmo padrão do `parse_endereco()` do extrator Trizy). Aplicado automaticamente em `aplicarItem()` ao carregar a cotação + botão manual "Copiar Localização" nos dois campos. **Bug pego e corrigido antes do deploy final:** a ordem original testava "já está limpo" (`UF_RE`, que só olha o final da string) antes de tentar extrair — strings ruidosas que terminam em "- UF" passavam batidas sem isolar o trecho certo; corrigido invertendo a ordem (extrai primeiro, só cai no "já limpo" depois). Testado no console do navegador em produção com 4 casos (ruidoso, URL, limpo, limpo com hífen) — todos corretos.
- **Limitação conhecida:** o aviso visual "Ajuste para Cidade/UF" (que mostra o botão) usa a regex `origemGeoOk` pré-existente, que é mais frouxa que o sanitizador — para strings digitadas manualmente que coincidentemente terminam em "- UF" válido, o aviso não aparece mesmo se o meio da string for ruidoso. Não afeta o fluxo real (dados de scraper passam pelo saneamento automático no load, independente desse aviso).

**5. Mapa + tipografia:** `MapaRota.tsx` — basemap CartoDB `dark_all` (era `light_all`, branco sobre UI dark = baixo contraste); rota com casing escuro por baixo + linha viva `#38bdf8` por cima (técnica cartográfica padrão); marcadores de pedágio com borda branca e raio maior. Inputs Origem/Destino/Produto `text-xs→text-sm`; Preço Proposto `text-xs→text-base font-semibold`; valores "Proposto"/"vs ANTT" e lista RAG `text-[10-11px]→text-base/text-sm`.
- Corrigido de bônus (mesmo arquivo, mesmo lint pass): 2x `react/no-unescaped-entities` (aspas retas em JSX).

---

### Hotfix crítico — QualP `/router/v4` 404 → `/rotas/v4` ✅
**Entregue:** 2026-07-02 (mesmo dia, resolvido com a URL/token corretos fornecidos pelo usuário)

O achado do M14 ("bloqueia TODA a calculadora") tinha duas causas empilhadas, não uma:

1. **URL errada:** `QUALP_URL` apontava para `/router/v4` (404). Correto: `/rotas/v4`.
2. **Header de auth errado:** o código usava `Authorization: Bearer <token>` → `/rotas/v4` respondia 401 "invalid credentials" mesmo com o token certo. QualP espera `access-token: <token>` (header próprio, sem "Bearer"). Descoberto testando as duas variantes via curl direto contra a API real antes de tocar no código.
3. **Schema de resposta é inteiramente diferente do que o código esperava** (provavelmente o código foi escrito contra uma versão de API/documentação diferente da que está live). Nomes em português, não em inglês:
   - `distancia.valor` (já em km — o código antigo tentava `data["distance"]` e dividia por 1000 assumindo metros)
   - `pedagios` é uma **lista** de praças, cada uma com `tarifa: {"<eixos>": valor}` (dict por número de eixos, não um total pronto) e **sem lat/lng** — só um `p_index` (índice do ponto correspondente dentro da polyline)
   - `polilinha_codificada`: polyline codificada no algoritmo padrão do Google, mas com **precisão 1e6** (não a 1e5 default do Google Maps) — precisou implementar `_decode_polyline()` do zero (sem lib nova) e usar `p_index` pra resolver lat/lng de cada pedágio
   - `tabela_frete.dados.A.<eixos>.<categoria>` — dict aninhado, não uma lista

**Processo de validação (nada foi deployado às cegas):**
1. `curl` direto na API real com o payload completo do `_build_payload()` já existente → confirmou schema real
2. Protótipo standalone em Python decodificando a polyline e comparando com `coordenada_inicio`/`coordenada_fim` da própria resposta → bateu
3. Reescreveu `_extract_distance/_extract_polyline/_extract_tolls/_extract_freight_table` no `qualp_service.py`
4. Testou as funções reais do módulo editado contra a resposta real salva (`sys.path` + import direto, sem precisar do servidor rodando)
5. Deploy na VPS + teste end-to-end via Puppeteer navegando na Torre real: clicou "Calcular Rota" numa cotação Trizy real → mapa escuro renderizou com rota real (278km, Brasnorte/MT→Campos de Júlio/MT), piso ANTT R$69,08/t, painel RAG mostrando o empty-state do M14, margem com preço de teste R$95/t em `text-base`

**Conclusão:** M14 está 100% validado visualmente agora — o bloqueador que impedia a confirmação completa foi removido no mesmo dia.

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
