# NO GRAIN OS — Milestones

**Última atualização:** 2026-07-02  
**Versão:** 3.1  
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

### M15 — Dashboard Ongo Cargas (Frete Geral Ongo) ✅
**Entregue:** 2026-07-02

**Contexto:** o card "FRETE GERAL ONGO" na Torre não abria nada dentro do app — era um `<a href>` puro pro Google Sheets externo. Não existia grid/dashboard in-app nem tabela no Supabase com os dados do Ongo Geral; `extract_ongo.py` só escrevia no Sheets. Também já existia um plano documentado nunca executado (`integrations/octamove-core/ongo_script_progress.md`) para fechamento diário 23:55 + Task Scheduler.

**Decisão de escopo (ajustada pelo usuário em runtime):** a proposta inicial tinha um cabeçalho com TOTAL CADÊNCIA / TOTAL ACIONADO / Aderência % (replicando o modelo antigo de "Aderência Transportadoras" do `ongo_script_progress.md`, com score de confiabilidade por transportadora). O usuário simplificou para **TOTAL DE LOTES / VOLUME LIBERADO TOTAL / SALDO RESTANTE DO DIA** — métricas mais diretas, sem breakdown por transportadora/check-in/reagendamento (essa ideia mais rica fica só documentada em `project_ongo_script.md` como backlog, não implementada).

**Banco (`backend/ongo_geral_migration.sql`):**
- Nova tabela `public.cargas_ongo` (`link_id_carga UNIQUE`, `municipio_origem`, `terminal_origem`, `origem`, `destino`, `produto`, `quantidade_kg`, `saldo_restante_kg`, `valor_proposto_ton`, `status`) — sincronizada a cada ciclo do extrator.
- **Sem tabela nova para o fechamento diário** — decisão deliberada: o RAG do precificador (`historico_fechamentos` + RPC `buscar_fretes_similares`, do M8) já é o motor que a calculadora consulta por similaridade de rota; uma tabela paralela não seria vista por ele. O fechamento do Ongo Geral escreve direto em `historico_fechamentos`.

**`extract_ongo.py` (raiz, script local Windows):**
- `_upsert_cargas_ongo()` — novo, chamado em `run_cycle()` logo após `_push_to_sheets()`; upsert real via `on_conflict="link_id_carga"` (a coluna já é UNIQUE, diferente de `painel_fretes.gmail_message_id` que precisou do workaround de check-antes-de-inserir no M17.2).
- `_generate_schema()` atualizado pra bater com a migração nova (estava desatualizado, sem município/terminal).

**Novo `fechamento_ongo_diario.py`:** agrega Volume Liberado × Saldo Restante por rota+produto a partir do estado atual de `cargas_ongo`, gera embedding (`text-embedding-3-small`, mesmo `_montar_texto` do `rag_service.py`) e insere em `historico_fechamentos` — replica o corpo de `indexar_fechamento()` localmente (script standalone, sem importar do backend FastAPI). Trava defensiva de divisão por zero aplicada em qualquer razão calculada.

**Agendamento:** `run_ongo_diario.bat` (`run_ongo_once.py` + `fechamento_ongo_diario.py`) + Task Scheduler Windows `OctamoveOngo_Diario` às 23:55 — registrado **sem** `-RunLevel Highest` (deu "Acesso negado" sem elevação; roda como usuário comum, suficiente).

**Frontend (`frontend-torre`):**
- `types/carga.ts`: novo tipo `CargaOngoGeral` (não reaproveita `CargaLogistica` — campos não batem).
- `app/api/ongo-geral/route.ts`: mesmo padrão REST cru contra o PostgREST do `trizy/cotacoes/route.ts` (sem SDK, `fetch` direto com `apikey`/`Authorization`).
- `app/page.tsx`: card `ongo_geral` trocado de `<a href={SHEET_URL}>` pra `<button onClick={() => setOngoGeralOpen(true)}>`; novo modal `OngoGeralModal` (não é o drawer lateral 480/720px dos outros — modal grande centralizado `inset-4 md:inset-10`, já que o conteúdo é uma planilha densa) com:
  - Bloco de resumo real-time (3 células, recalculado via `useMemo` a partir das linhas **filtradas**)
  - Filtros dinâmicos (Município Origem / Terminal Origem / Empresa) — `<select>` com opções únicas derivadas das linhas
  - Grid com o mesmo design system das outras tabelas (header sticky, `text-[10-11px]`, `tabular-nums font-mono`)
  - Botão **"Abrir planilha"** no cabeçalho do modal (mantém acesso ao Google Sheets original — pedido explícito do usuário depois do primeiro teste, pra não perder a opção antiga)

**Bug corrigido — card zerado até o primeiro clique:** `ongoGeralRows` só era buscado num `useEffect` gatilhado por `ongoGeralOpen`, então o card mostrava contagem 0 até o usuário abrir o modal pela primeira vez. Fix: fetch de `/api/ongo-geral` movido pro mesmo efeito de polling do Trizy (`fetchTrizy`, a cada 10s desde o mount), igual ao padrão já usado por `trizyCount`/`trizyCotacoes` — agora o card já mostra o número certo assim que a página carrega.

**Dois bugs pré-existentes descobertos e corrigidos no processo (bloqueavam a primeira execução real do script, não relacionados à feature em si):**
1. Console Windows usa `cp1252` por padrão fora de um terminal UTF-8 real — `extract_ongo.py` tem vários `print()` com `→`/emojis que derrubavam o processo com `UnicodeEncodeError` (isso também quebraria o cron das 23:55 ao redirecionar output pro log via `.bat`). Fix: `sys.stdout/stderr.reconfigure(encoding="utf-8", errors="replace")` no topo do módulo.
2. `.env` raiz tinha `GOOGLE_CREDENTIALS_PATH=octamove-core/credentials.json google sheets.json` (relativo a `C:\Users\Dell`), mas o arquivo real está em `no-grain-os/integrations/octamove-core/`. Path errado fazia `_sheets_client()` chamar `sys.exit(1)` antes de chegar no upsert do Supabase. Fix: path corrigido no `.env`.

**Armadilha de migração:** a primeira tentativa de rodar `ongo_geral_migration.sql` no Supabase SQL Editor deu `syntax error at or near "CREATE"` — causa provável: caracteres decorativos não-ASCII nos comentários (`═`, `──`, acentos) corrompidos no copiar/colar pro editor web. Reescrito em ASCII puro (sem acentos/box-drawing) e rodou sem erro na segunda tentativa.

**Validado:**
- `npm run build` limpo (tipagem + 13 rotas geradas)
- Testado no navegador via Puppeteer com dados mockados (fetch interceptado) antes de ter dados reais: modal abre, resumo calcula certo, filtro recalcula os 3 totais instantaneamente
- Migração aplicada em produção pelo usuário; `run_ongo_once.py` rodado manualmente após os 2 fixes — **171 lotes reais sincronizados em `cargas_ongo`**, confirmado via `Content-Range` do PostgREST
- Deploy na VPS (`deploy_vps.py`) feito 2x (feature completa + fix do card zerado), health check OK nas duas vezes, `curl` em produção confirmou dados reais servidos por `http://2.24.201.246:3000/api/ongo-geral`

**Pendente (backlog, não bloqueia M15):** Task Scheduler roda **local no Windows** do usuário, não na VPS — o fechamento das 23:55 depende do notebook estar ligado nesse horário. Breakdown por transportadora (check-in/reagendamento/score) do plano original não foi implementado — ver `project_ongo_script.md`.

### M16 — Ingestão Avançada: Gmail Anti-Ruído + Triagem WhatsApp (Backlog)
- Filtro classificador Gmail (RAG de triagem) — só Cotações de Frete e Liberações de Embarque
- Card WhatsApp com volumetria tipificada: `Total X — Informações Y — Cotações Z`
- Parser de "Embarque Liberado" (BTG/Ricelly) → card/campo "Liberações" estruturado
- Botão `[Tratado]` no Radar WhatsApp — oculta da fila visual, mantém arquivado no banco

### M17 — Precisão Geográfica: Ponto Exato no QualP ✅
**Entregue:** 2026-07-02
**Gatilho:** BID Trizy 00067487 — rota Brasnorte/MT → Campos de Júlio/MT deu **800+ km** na
calculadora contra **293 km** reais no Google Maps (endereço completo: Usimat MT-388 →
Fazenda Tricolor). Reproduzido manualmente digitando os mesmos endereços direto no site do
QualP: **348 km** — provando que a API geocodifica endereço completo normalmente; o motivo do
erro estava 100% no nosso código, que descartava o nome do local antes de mandar pro QualP.

**Causa raiz:**
- `frontend-torre/app/api/trizy/cotacoes/route.ts` (`mapRow()`) montava `origem`/`destino`
  priorizando **só** `Cidade/UF`, descartando `entidade_origem`/`ponto_coleta_nome` (o nome do
  local: "Usimat", "Fazenda Tricolor").
- `sanitizeLocalizacao()` no frontend reforçava esse truncamento, mesmo quando o texto mais
  detalhado já estava disponível.
- O link "Ver ponto exato no Maps" da Trizy (`localizacao_origem_link`) não é um pin fixo — é
  uma URL de **busca** (`google.com/maps/search/{texto}`) sem coordenada embutida; o texto que
  ela carrega já está salvo cru nos campos `local_coleta_full`/`entidade_origem_trizy`.

**Milestone A — Motor (backend):**
- `services/qualp_service.py`: extraída `_chamar_qualp()` (POST puro, sem cache); `consultar_rota()`
  ganhou `origem_fallback`/`destino_fallback` opcionais — se a chamada com ponto exato falhar
  (erro HTTP ou `distancia_km <= 0`), refaz automaticamente com a Cidade/UF de fallback e retorna
  `aviso: "Ponto exato indisponível no QualP. Calculando pela sede do município."`. Assinatura
  100% retrocompatível (params novos são opcionais, comportamento antigo inalterado sem eles).
- `routers/precificar.py`: `PrecificarRequest` ganhou `origem_ponto_exato`/`destino_ponto_exato`
  (texto "Nome do Local, Cidade/UF"), `origem_maps_link`/`destino_maps_link` e `origem_lat/lng`
  `destino_lat/lng`. `_resolver_ponto_exato()` decide o que mandar pro QualP com prioridade:
  coordenada já geocodificada (Ongo/WhatsApp/Gmail via `coords_coleta_lat/lng`) → coordenada
  extraída do link do Maps (reaproveita `services/location_parser.extrair_coords()`, raro dar
  match na Trizy) → texto do ponto exato (o que resolveu o caso real: 800km → ~348km).
- Response `rota` agora inclui `aviso` (null em cálculo normal).

**Milestone B — UX (frontend, `app/torre/calcular/[id]/page.tsx`):**
- Campos "Origem"/"Destino" continuam só os dois de sempre — sem inputs novos. Por padrão
  seguem preenchidos com `Cidade/UF` limpa via `sanitizeLocalizacao()` (comportamento inalterado).
- Badge `🏢 {nome do local} · ⚡ Usar Ponto Exato` abaixo de cada campo, só quando a cotação tem
  `origem_localidade`/`destino_localidade` (Trizy) ou coordenada (`coords_coleta_lat/lng`, quando
  a fonte for Ongo/WhatsApp/Gmail). Sem dado específico, a linha some — zero poluição visual.
  Clicar reescreve o input pra `"Nome do Local, Cidade/UF"` e vira `✓ Ponto Exato Ativo` (verde).
  Clicar de novo volta pra Cidade/UF. Campo continua 100% editável — o estado "ativo" é
  *derivado* (`input === texto do ponto exato`), não uma flag separada, então editar o texto à
  mão desativa o modo automaticamente, sem dessincronizar.
- `calcular()` manda a Cidade/UF congelada (`origemCidadeUfBase`) como fallback junto com o
  payload de ponto exato; toast automático se o backend devolver `aviso`.

**Validação:**
- `_resolver_ponto_exato()` testado isoladamente: prioriza coords explícitas → coords do link →
  texto → `None`. Confirmado com os 4 casos (coords, link sem coord, link com coord `/@lat,lng`,
  nada disponível).
- `consultar_rota()` testado ao vivo contra Supabase real (cache hit e caminho `sem_token`) —
  novas chaves `origem_usada`/`destino_usada`/`aviso` presentes e corretas nos dois caminhos, sem
  quebrar o fluxo antigo. Fallback contra geocodificação real não testado localmente por falta de
  `QUALP_API_TOKEN` no `.env` local (vazio) — validar na VPS, que tem o token de produção.
- `npx tsc --noEmit` limpo e `npm run build` (Next.js/Turbopack) compilou as 12 rotas sem erro.

**Deploy validado (2026-07-02):** VPS testada ao vivo via Puppeteer na cotação 00067487 real —
badge funcionando, mapa renderizando rota real, 278km (vs. 800+km antes). No caminho, achado e
corrigido bug separado no `deploy_vps.py`: `FRONTEND_ENV` sobrescrevia o `.env.local` sem as
chaves do Supabase a cada deploy, quebrando `/api/trizy/cotacoes` silenciosamente.

**Investigação do gap QualP (278km) vs. teste manual no site do QualP (348km):** testado
`type_route` (`efficient/shorter/shortest/faster/fastest/cheaper/cheapest`) direto contra a API
real — **não é a causa**, todos retornam ~278km. Testado também variar `axis` (2 a 9) e pedir
`alternative_routes` — QualP só considera uma rota "boa" pra essas coordenadas, nada muda.
Causa real, confirmada inspecionando `coordenada_inicio`/`coordenada_fim` da resposta: o QualP
**nunca geocodifica "Fazenda Tricolor"** — em 3 tentativas de texto diferentes (com e sem CEP),
a coordenada de origem voltou **idêntica** (`-12.12927,-57.99804`, o centro do município de
Brasnorte). O QualP não tem propriedades rurais privadas no gazetteer dele; cai pro centro da
cidade silenciosamente, sem erro. Já "Usimat" (uma cooperativa real) o QualP acha, mas com
precisão instável dependendo do texto — `"USIMAT, MT-388"` (com referência de rodovia) reproduziu
exatamente os 348km do teste manual.

### M17.1 — Google Geocoding: tentado e abortado (restrição de billing) ❌
**Tentativa:** 2026-07-02

Implementado, testado e deployado (`services/google_geocoding_service.py` +
`_resolver_ponto_exato()` async com etapa extra de geocodificação). Chave gerada pelo cliente
(`GOOGLE_API_KEY`) testada local e na VPS — Google respondeu `REQUEST_DENIED`
("The provided API key is invalid.") nos dois ambientes, confirmando que não é problema de
rede/IP e sim de configuração no Google Cloud Console (Geocoding API não habilitada e/ou billing
não vinculado ao projeto). **Abortado a pedido do cliente** por restrição de billing no Console.

**Revertido por completo em 2026-07-02:** removido `services/google_geocoding_service.py`,
`GOOGLE_API_KEY` de `core/config.py`/`.env`/`deploy_vps.py`, e a etapa de geocoding em
`_resolver_ponto_exato()` (voltou a ser síncrona: coordenada explícita → coordenada do link do
Maps → texto cru pro QualP). Estrutura da M17 (badge "Usar Ponto Exato" + fallback pra Cidade/UF)
permanece 100% ativa e funcional em produção, sem a etapa de satélite.

### M17.2 — Fix: cotações do Gmail paravam de ser gravadas (perda silenciosa) ✅
**Entregue:** 2026-07-02

**Sintoma:** enquanto investigava o M17.1, os logs de erro da VPS mostraram um erro recorrente
em toda tentativa de inserção via Gmail: `there is no unique or exclusion constraint matching
the ON CONFLICT specification` (Postgres `42P10`).

**Causa raiz (duas, compostas):**
1. `services/supabase_writer.py::inserir_frete()` usava
   `.upsert(row, on_conflict="gmail_message_id")`, que exige um índice UNIQUE na coluna
   `gmail_message_id` da tabela `painel_fretes` pro Postgres saber resolver o conflito. Esse
   índice **nunca foi aplicado em produção** — existe uma migration pronta pra isso
   (`migrations/fix_gmail_dedup.sql`, "roda uma vez no Supabase dashboard ou via psql") que
   ninguém rodou. Resultado: toda gravação via Gmail falhava com 400.
2. `services/gmail_service.py::poll_gmail_fretes()` marcava a mensagem como processada
   (`novos_ids.add(msg_id)`) **mesmo quando a gravação falhava** (não checava se
   `registro_id` veio `None`) — cada cotação que caía no erro acima era silenciosamente
   descartada pra sempre, sem nunca ser salva e sem nunca ser retentada.
3. **Agravante:** `deploy_vps.py` sobrescrevia `processed_gmail_ids.json` com `[]` a cada
   deploy — isso derrubava até esse dedup local, causando picos de reprocessamento (e
   consequentemente picos do erro 42P10) toda vez que alguém rodava um deploy.

**Correções aplicadas** (sem precisar de migration/acesso direto ao Postgres — só reescreveu a
lógica de gravação pra não depender da constraint ausente):
- [x] `services/supabase_writer.py`: trocado `upsert(on_conflict=...)` por
      checa-antes-de-inserir (`SELECT id WHERE gmail_message_id=eq...` → se existir, retorna o
      id existente sem tentar inserir de novo; senão, `INSERT` normal). Testado localmente
      contra o Supabase real: 1ª inserção cria linha, 2ª com o mesmo `gmail_message_id`
      deduplicada sem erro. Linha de teste removida depois.
- [x] `services/gmail_service.py`: só marca a mensagem como processada quando `registro_id`
      não é `None`; falha de gravação agora conta como erro e a mensagem é **retentada no
      próximo ciclo** (1min) em vez de ser perdida pra sempre.
- [x] `deploy_vps.py`: `processed_gmail_ids.json` só é criado se não existir
      (`test -f ... || echo '[]' > ...`), não sobrescreve mais o dedup a cada deploy.
- [x] **Recuperação das cotações perdidas:** resetado `processed_gmail_ids.json` uma vez (ação
      manual, pós-fix) pra forçar reprocessamento das 8 mensagens que tinham ficado marcadas
      como processadas sem nunca terem sido salvas. Resultado no ciclo seguinte:
      `injetados: 7, ignorados: 0, erros: 0` — as 7 cotações reais (1 já tinha sido recuperada
      no ciclo anterior) confirmadas como linhas novas em `painel_fretes` com
      `gmail_message_id` preenchido.
- [x] Deploy VPS validado, backend/frontend online, health check OK, ciclos subsequentes do
      scheduler (1min) rodando limpos sem erro.

### M17.3 — Migration `fix_gmail_dedup.sql` aplicada em produção ✅
**Entregue:** 2026-07-02

Rodada pelo cliente via Supabase Dashboard → SQL Editor (sem acesso direto a Postgres/Management
API disponível — nenhuma connection string ou personal access token `sbp_...` encontrado no
projeto; opção escolhida foi rodar manualmente em vez de compartilhar mais credenciais).

**Validação (com alguns falsos negativos pelo caminho, documentados aqui pra não confundir uma
próxima investigação):**
- 1ª tentativa de validar via `upsert(on_conflict="gmail_message_id")` → continuou dando
  `42P10`. Não é bug da migration: o índice criado é **parcial**
  (`WHERE gmail_message_id IS NOT NULL`), e o mecanismo de upsert do PostgREST gera
  `ON CONFLICT (coluna) DO UPDATE` sem o predicado `WHERE` — Postgres exige que o predicado do
  `ON CONFLICT` bata exatamente com o do índice parcial pra usá-lo como alvo. Limitação conhecida
  do PostgREST com índices parciais, não afeta o código em produção (que não usa mais upsert).
- 1º teste de `INSERT` duplicado direto (sem `on_conflict`) → passou (201), parecendo indicar que
  o índice não existia. Era falso negativo: a linha-alvo da duplicata (`gmail_message_id` da
  cotação "DDG Milho" recuperada em M17.2) já tinha sido removida por uma re-execução do Passo 3
  da própria migration (limpeza de duplicatas históricas) entre um teste e outro.
- Usuário confirmou via `SELECT indexname, indexdef FROM pg_indexes WHERE tablename=
  'painel_fretes' AND indexname='painel_fretes_gmail_message_id_key'` que o índice existe.
- Teste definitivo — duplicar uma linha confirmada existente no instante do teste → rejeitado
  corretamente: `HTTP 409, code 23505: duplicate key value violates unique constraint
  "painel_fretes_gmail_message_id_key"`. **Índice único confirmado ativo e aplicado pelo
  Postgres.**
- Linhas de teste (`TESTE DUP/MT`, `TESTE DUP2/MT`) removidas do banco após cada verificação.

**Efeito colateral observado (esperado, não é bug):** o Passo 3 da migration (limpeza de
duplicatas históricas por `fonte_ingestao+embarcador+produto+origem+destino`, mantém a linha mais
antiga) rodou mais de uma vez durante a investigação e removeu 5 das 7 linhas recuperadas em
M17.2 por serem duplicatas de cotações antigas já existentes (de antes do fix, sem
`gmail_message_id`) — a linha mais antiga sobreviveu com os mesmos dados de negócio (origem,
destino, produto), só sem o vínculo daquele `gmail_message_id` específico. Sem perda de
informação comercial; sobraram 2 das 7 linhas com `gmail_message_id` preenchido.

**Estado final:** dedup em duas camadas — aplicação (`supabase_writer.py`, checa-antes-de-inserir)
+ banco (índice único parcial, agora como defesa contra concorrência real). Sistema de ingestão
Gmail validado de ponta a ponta.

---

## PRÓXIMOS MILESTONES (Backlog)

| # | Milestone | Descrição | Prioridade |
|---|-----------|-----------|------------|
| M10 | Trizy FASE 2 — POST Lance | Botão "Fazer Oferta" na calculadora: `POST /bid/transportadora/cotacao-frete/{negociacaoId}/lance` | Alta |
| M10 | Trizy — Token auto-renovação Task Scheduler | Agendar `trizy_login.py` diário para manter sessão ativa | Alta |
| M10 | Trizy — Alerta WhatsApp | Enviar mensagem via Evolution API quando novo BID chega com produto/rota de interesse | Alta |
| M11 | Trizy — CRM N8N | Workflow N8N que lê `status_crm` e dispara ações (resposta, acompanhamento) | Média |
| — | Ongo Aba Aderência | Implementar aba "Aderência Transportadoras" (check-in/reagendamento/score por transportadora) no `extract_ongo.py` — ver M15 | Média |
| — | Ongo Task Scheduler na VPS | Hoje roda local no Windows do usuário; migrar pra cron na VPS tornaria o fechamento 23:55 independente do notebook estar ligado | Média |
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
| Calculadora dava 800+km em rotas curtas | Premissa errada de que "QualP só geocodifica Cidade/UF" — código descartava nome do local (fazenda/terminal) antes de mandar pro QualP, que geocodificava a sede do município ao invés do ponto real | M17: mandar `"Nome do Local, Cidade/UF"` ou lat/lng; QualP geocodifica endereço completo normalmente (testado manualmente: 348km vs 800+km) |
| Link "Ver ponto exato no Maps" da Trizy não tem coordenada | `localizacao_origem_link` é uma URL de **busca** (`/maps/search/{texto}`), não um pin — não confundir com link de Gmail/WhatsApp que pode ter `/@lat,lng` ou `!3d!4d` | Usar o texto cru (`local_coleta_full`/`entidade_origem_trizy`) direto, sem tentar parsear coordenada desse link específico |
| GPT-4o-mini `nivel_confianca` não-determinístico | Temperatura do modelo | Não usar `nivel_confianca` como gate de cotação |
