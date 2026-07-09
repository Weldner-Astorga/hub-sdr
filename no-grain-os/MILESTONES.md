# NO GRAIN OS — Milestones

**Última atualização:** 2026-07-07  
**Versão:** 3.5  
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

### M16 — Ingestão Avançada: Gmail Anti-Ruído + Triagem WhatsApp ✅ (parcial)
**Entregue:** 2026-07-06 — 3 dos 4 itens (Grupo 2 do punch-list pós-auditoria M19)

**1. Anti-ruído Gmail:** achado que o "Fix Classificador — Determinismo" (2026-06-26) só tinha
sido aplicado no WhatsApp (`webhook_evolution.py`) — `gmail_service.py` ainda gateava cotação por
`nivel_confianca == "baixo"` (GPT-4o-mini não-determinístico nesse campo, armadilha já conhecida).
Trocado pro mesmo critério robusto: `origem/destino != "Não Especificado"`. Mesma correção já
provada, só replicada no lugar que faltava.

**2. Card WhatsApp com volumetria tipificada:** `routers/whatsapp_timeline.py` ganhou
`total_cotacao`/`total_aviso` (contagem exata via PostgREST `count=exact`); card "Radar WhatsApp"
mostra `"{cotações} cotações · {avisos} avisos"` em vez de legenda genérica. Validado em produção:
**6 cotações vs. 187 avisos** — confirma na prática o quanto o Radar era ruído puro sem essa
visibilidade.
- **Bug achado e corrigido de bônus:** o `select` do endpoint nunca buscava `grupo_nome`, mesmo a
  coluna existindo desde o M5 e o frontend já ter o badge pronto — o badge nunca aparecia. Um
  `SELECT` de uma palavra faltando.

**3. Botão `[Tratado]`:** nova coluna `whatsapp_timeline.tratado` (migration
`backend/whatsapp_tratado_migration.sql`); `GET /api/whatsapp/timeline` filtra `tratado=false` por
padrão; `PATCH /api/whatsapp/timeline/{id}/tratado` marca sem deletar. Botão no
`RadarWhatsAppTimeline` remove o item da lista local na hora (otimista).

**Validado ao vivo (VPS):** card mostrando "6 cotações · 186 avisos" após marcar 1 item; badge de
grupo aparecendo (`"COA - Central Agrícola"`); item marcado Tratado sumiu da gaveta e confirmado
`tratado=true` persistido via Supabase REST.

**Pendente (não incluído, falta amostra real):** parser de "Embarque Liberado" (BTG/Ricelly) — sem
exemplo de mensagem real pra basear o parser, fica em backlog até termos um caso concreto.

**Achado não corrigido (fora de escopo, notado ao ler os textos das mensagens):** mojibake visível
nos textos do WhatsApp (`"jÃ¡ deu uma luz"` em vez de `"já deu uma luz"`) — sugere
double-encoding em algum ponto da ingestão Evolution API. Não investigado nesta rodada.

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

## FASE 5 — Auditoria de Fluxo de Cotação

### M19 — Auditoria de Fluxo + Fix Preço Comercial Final (Drawer) ✅
**Entregue:** 2026-07-06

**Contexto:** sessão de auditoria testando a Torre como usuário real (cotação Cooperbem via
e-mail) revelou vários gaps no fluxo de cotação. Um deles tinha causa raiz clara e correção
imediata; os demais viraram achados documentados abaixo, para não se perderem.

**Causa raiz do bug corrigido:** o campo "Preço Comercial Final (R$/t)" no rodapé do
`CotacaoDrawer` (`frontend-torre/app/page.tsx`) só alimentava o texto do "Copiar Dados Brutos" —
não existia botão de salvar dedicado, e os botões GANHA/PERDIDA (`handleFechar` →
`fecharCotacao`) nunca enviavam esse valor a lugar nenhum. Era possível fechar uma cotação como
GANHA sem o preço final comercial jamais ser persistido no banco.

**Correção (frontend apenas, zero mudança de backend):**
- Nova função `salvarPrecoFinal()` reaproveita `PATCH /cotacoes/{id}/preco`
  (`backend/routers/cotacoes.py:188-231`) — o mesmo endpoint já usado pela calculadora
  (`salvarPreco()` em `app/torre/calcular/[id]/page.tsx`), que já calcula margem vs. ANTT e já
  tem fallback Trizy (`_update_trizy`, do M14). Nenhum endpoint novo foi necessário.
- Botão **"Salvar"** ao lado do input do preço final, com estado de loading próprio
  (`salvandoPrecoFinal`) e atualização otimista do status na tabela via `onUpdateStatus`.
- `handleFechar(status)`: se houver valor digitado em "Preço Comercial Final", salva primeiro
  (bloqueia o fechamento em caso de falha) antes de chamar GANHA/PERDIDA — não é mais possível
  fechar uma cotação com um preço digitado e não confirmado.

**Decisão de produto registrada — Fluxo Híbrido de Cotação:** decidido que o fluxo de cotação
(recepção → radar/triagem → calculadora → precificação filial → auditoria/diretoria → resposta →
status) será **assistido por IA, não automatizado de ponta a ponta**. A IA cuida do trabalho
mecânico (extração de dados, geocoding, cálculo de rota/pedágio/ANTT, sugestão de preço via RAG,
redação da resposta); o humano segue decidindo e confirmando os pontos de risco financeiro —
preço final (este milestone corrige exatamente esse ponto) e envio da resposta ao cliente. Para
lidar com a diversidade de formatos por cliente, a calibração será via **perfil few-shot por
cliente** (poucos e-mails reais + extração correta, guardados por domínio/remetente e injetados
no prompt), montado no onboarding do cliente antes de ele ir para produção plena — não fine-tuning
do modelo (caro, lento, exige volume de dados que um cliente novo não tem). Ver PRD.md 9.3.

**Achados da auditoria ainda não corrigidos (backlog, ver PRD.md 9.1):**
- Prazo de resposta às vezes extraído errado mesmo com a regra 11 já existente no
  `SYSTEM_PROMPT` (`openai_service.py`) — reforça a armadilha já conhecida do `nivel_confianca`
  não-determinístico do GPT-4o-mini.
- Radar WhatsApp sem triagem cotação-vs-ruído com fila de revisão separada por confiança —
  relacionado ao M16 (Gmail Anti-Ruído + Triagem WhatsApp), hoje em backlog.
- Histórico diário: falta decidir onde grava o fechamento das 23:59 (aba própria no Sheets com
  seletor de data) e consistência do filtro de Status do Radar com o padrão de filtros dinâmicos
  já usado no modal Ongo Geral (M15). Logo do Trizy no card — item cosmético, baixo esforço.

**Validado:** `npx tsc --noEmit` e `npm run build` limpos em `frontend-torre`.

**Fix adicional (mesmo dia) — Seção "Localização" no Drawer para Gmail/WhatsApp:** o Drawer só
tinha localização detalhada para a fonte Trizy; para Gmail/WhatsApp, adicionada seção própria
(painel esquerdo, entre SLA e o bloco Trizy) que usa `origem_maps_link`/`destino_maps_link` se
existirem, ou monta o link a partir de `coords_coleta_lat/lng`/`coords_entrega_lat/lng` (mesmo
padrão de `?q=lat,lng` que o `location_parser.py` já produz); quando não há nenhum dos dois, exibe
"Localização de origem/destino não confirmada" em vez de esconder a seção — espelha o
comportamento já existente na calculadora (link quando geocodificável, aviso quando não), sem
alterar nada da calculadora em si. Testado ao vivo na VPS nos dois caminhos (sem coordenada real da
cotação Cooperbem, e com coordenada injetada temporariamente para validar o link `Maps Origem` →
restaurado ao estado original depois).

**Fix adicional (mesmo dia) — mesma lógica de Localização também para Trizy:** o bloco "Links
Google Maps" da seção Trizy do Drawer omitia silenciosamente o link quando
`origem_maps_link`/`destino_maps_link` estavam ausentes (diferente do padrão recém-criado acima).
Unificado: agora as **3 fontes de ingestão (WhatsApp, Gmail, Trizy/portais externos) usam a mesma
regra** — link clicável quando existe, "Localização de coleta/descarga não confirmada" quando não.
Testado ao vivo com um BID sem link (`#00066177`, mostra os dois avisos) e um BID com link
(`#00066207`, mostra "Maps Coleta"/"Maps Descarga" clicáveis).

**Fix adicional (mesmo dia) — Card Gmail sem clique:** causa raiz mais funda do que parecia —
`FonteCard` (`app/page.tsx`) só embrulhava o card num `<button>` para três fontes hardcoded
(`isOngo`/`isWhatsApp`/`isTrizy`); qualquer outra fonte, mesmo recebendo `onClick` via prop, caía
num `<div>` sem clique nenhum — a variável `isClickable` já existia calculada mas não era usada
na decisão de renderização. Generalizado o `if` final para `isClickable`, e adicionado o branch
`gmail_cotacao` no `onClick`/`active` do grid de source cards (mesmo padrão de toggle de
`filtroFonte` já usado pelo card Trizy). Testado ao vivo na VPS: clique no card "Cotações Email
(Gmail)" agora filtra o Radar de Cotações para Gmail (24 registros, batendo com o contador do
card).

---

## FASE 6 — Geocoding e Robustez de Localização

### M20 — Geocoding real via Nominatim (Grupo 1 do punch-list pós-auditoria) ✅
**Entregue:** 2026-07-06

**Contexto:** o M17.1 tinha implementado geocoding de texto via Google Maps API, mas reverteu por
restrição de billing no Google Cloud Console do cliente (não era erro de design). Retomado agora
com **Nominatim (OpenStreetMap)** — API pública, gratuita, sem chave/billing.

**O que foi criado:**
- `backend/services/geocoding_service.py` — `geocode_endereco()`, cache-aside contra nova tabela
  `geocoding_cache` (mesmo padrão de `qualp_cache`/`qualp_service.py`), fallback pro Nominatim
  (`GET nominatim.openstreetmap.org/search`, `User-Agent` próprio, `countrycodes=br`) em cache miss.
- `backend/services/location_parser.py`: `extrair_endereco_busca()` (novo — extrai texto de
  `daddr=`, `/maps/search/`, `/maps/place/`) e `resolver_coords_com_geocoding()` (orquestra
  `extrair_coords()` existente → `extrair_endereco_busca()` → `geocode_endereco()`). `extrair_coords()`
  em si **não foi alterado** — é só o primeiro degrau da nova cadeia.
- `gmail_service.py` e `webhook_evolution.py`: trocado `extrair_coords()` por
  `await resolver_coords_com_geocoding()` na ingestão — grava `coords_coleta_lat/lng` mesmo quando
  o link do Maps só tinha texto de endereço, não coordenada. Isso alimenta automaticamente o bloco
  "Localização" do Drawer (M19) e o badge "Ponto Exato" da calculadora (M17), sem mudar nenhum dos
  dois.
- `routers/precificar.py::_resolver_ponto_exato()`: virou `async`, ganhou mais um degrau antes do
  fallback pro texto cru — geocodifica via `geocode_endereco()` quando só há texto do ponto exato
  (Trizy/manual), antes de mandar pro QualP (que só acerta cidade/UF em endereço rural específico).
- `backend/geocoding_cache_migration.sql` — aplicada em produção pelo usuário via SQL Editor.

**Validado (VPS, produção real):**
- `extrair_endereco_busca()` contra a URL real da cotação Cooperbem → extraiu
  `"Campo Verde, MT, 78840-000"` corretamente.
- `resolver_coords_com_geocoding()` → Nominatim resolveu `(-15.5430787, -55.1590511)` (coordenada
  real de Campo Verde/MT); segunda chamada confirmada como cache HIT (linha persistida em
  `geocoding_cache`, verificado via Supabase REST).
- `POST /api/precificar/` com `destino_ponto_exato` sem coordenada (`"Rumo, Rondonopolis/MT"`) →
  HTTP 200, geocoding resolveu, QualP calculou 92km, sem `aviso` de fallback.

**Backlog restante desta linha:** nenhum — Grupo 1 do punch-list concluído. Próximo: Grupo 2
(M16 — triagem do Radar por confiança).

---

### M21 — Logo Trizy, Filtro de Status Dinâmico, Histórico com Data na Torre (Grupos 3+4) ✅
**Entregue:** 2026-07-06

**1. Logo Trizy:** usuário enviou o arquivo (`public/trizy-logo.png`); `FonteCard` renderiza a
imagem no lugar do ícone genérico `Truck` especificamente para `ongo_cotacao`.

**2. Filtro de Status — fix de completude:** o `<select>` de Status do Radar tinha só 6 das 9
opções possíveis (faltavam `RECEBIDA`, `CALCULADA`, `COTADO_AGUARDANDO` — hardcoded à mão e nunca
atualizado). Trocado por `[...STATUS_OPCOES, 'COTADO_AGUARDANDO'].map(...)` usando os labels de
`STATUS_CONFIG` — única fonte de verdade, sem duplicar a lista.

**3. Histórico com seletor de data dentro da Torre:** não existe tabela Supabase com snapshot
diário do Ongo — só a aba "Histórico" do Sheets (append-only, escrita por
`extract_ongo.py::_compute_historico_rows()`). Criado:
- `services/sheets_reader.py::listar_historico(data_filtro)` — lê `Histórico!A:M`, filtra por
  "Data Captura" (`DD/MM/YYYY`), mesmo padrão de `_get_service()`/parsing já usado pra aba
  "Carregamentos".
- `routers/ongo_historico.py` — `GET /api/ongo-geral/historico?data=DD/MM/YYYY` (default hoje),
  registrado em `main.py`.
- Proxy `app/api/ongo-geral/historico/route.ts` + `OngoGeralModal` ganhou abas "Ao Vivo"/"Histórico"
  — Histórico tem `<input type="date">` + tabela com as 13 colunas originais da aba.

**Validado ao vivo (VPS):** `curl /api/ongo-geral/historico?data=03/07/2026` retornou linhas reais
(o único ciclo bem-sucedido antes do crash do Playwright investigado antes); testado no navegador
— aba Histórico com a mesma data populando a tabela corretamente; card Trizy mostrando a logo real;
dropdown de Status confirmado com as 9 opções.

**Achado não corrigido (fora de escopo, notado nos dados da aba Histórico):** o campo "Rota" tem o
mesmo tipo de mojibake já visto no WhatsApp (`"â†'"` em vez de `"→"`) quando inspecionado via
`curl`/terminal — no navegador renderiza certo, então é mais provável ser um artefato de exibição
do terminal Windows do que corrupção real do dado; não investigado a fundo.

**Backlog restante do punch-list pós-auditoria:** nenhum — Grupo 5 concluído a seguir (M22).

---

### M22 — Retry de Login + Alerta WhatsApp no Cron do Ongo (Grupo 5) ✅
**Entregue:** 2026-07-06

**Contexto:** causa raiz já investigada nesta mesma sessão (ver M21/histórico da conversa) —
`extract_ongo.py::_login()` pode ter o Chromium crashando durante o login
(`Navigation failed because page crashed!`), sem retry, derrubando o script inteiro em
`run_ongo_once.py` silenciosamente. Migrar pra VPS foi descartado (risco de bloqueio anti-bot no
IP de datacenter, decisão já registrada) — mitigação local: retry + alerta.

**O que foi criado (100% local, nada na VPS):**
- Novo `C:\Users\Dell\whatsapp_alert.py` — `alertar_falha(origem, detalhe)`, best-effort (nunca
  propaga exceção), via Evolution API (`POST /message/sendText/octamove`).
- `.env` raiz ganhou `EVOLUTION_URL`/`EVOLUTION_KEY`/`EVOLUTION_INSTANCIA`/`ALERTA_WHATSAPP_DESTINO`
  — destino é o grupo **"Teste fretes"** (`120363410106462149@g.us`, já autorizado em
  `webhook_evolution.py`), resolvido a partir de um link de convite via
  `GET /group/inviteInfo/octamove?inviteCode=...` (consulta, sem entrar no grupo).
- `run_ongo_once.py`: login agora tenta até 3x, **cada tentativa com browser e página novos**
  (uma página crashada não pode ser reaproveitada); todo o script roda dentro de um `try/except`
  que aciona `alertar_falha` em qualquer falha (não só login) antes de relançar.
- `fechamento_ongo_diario.py`: os 2 early-returns por env var ausente e o bloco `__main__` também
  acionam `alertar_falha`.

**Validado ao vivo, com chamadas reais (nada mockado):**
- Payload da Evolution API confirmado testando contra o número pessoal do usuário antes de decidir
  o destino final.
- Ciclo completo real (`run_ongo_once.py` + `fechamento_ongo_diario.py`) rodado do zero após a
  mudança — login OK de primeira, 133 cargas/33 novas, 150 rotas indexadas no RAG — confirma que o
  caminho feliz não regrediu.
- Falha simulada (script de teste isolado no scratchpad, `m._login` forçado a sempre lançar
  exceção): confirmadas as 3 tentativas reais com browser novo a cada uma, e o alerta disparado e
  **recebido de fato** no grupo "Teste fretes".

---

## FASE 7 — Auditoria Comercial GTM + Robustez de I/O

### M23 — Auditoria de UX/GTM da Torre como usuário final ✅
**Entregue:** 2026-07-07

**Contexto:** auditoria "fast" pedida pelo usuário — navegação ao vivo na Torre em produção
(Puppeteer, VPS real) sob a ótica de um diretor comercial de logística sênior avaliando o produto
como algo pra ir a mercado e faturar rápido (ver [[project_torre_gtm_estrategia]]).

**Achados principais (documentados, nem todos ainda corrigidos):**
- **Ponto cego mais grave:** as 44 cotações do Trizy BID ficavam 100% invisíveis nos KPIs
  "Pendentes"/"Aguardando Resposta" (esses cards só contam `painel_fretes`) — canal pago sem
  nenhum alerta de que está parado. Ainda não corrigido (ver backlog).
- **Gap estratégico:** dashboard "Frete Geral Ongo" (M15) mostra o mundo do embarcador
  (Agrícola Alvorada), não o da transportadora — mas a estratégia de GTM já definida é vender pras
  38 transportadoras, não pro embarcador. **Decisão confirmada pelo usuário:** todo trabalho futuro
  de inteligência/analytics (backlog PRD 9.2 — Score de Compliance, Taxa de Cancelamento, etc.) é
  sempre pela ótica da transportadora; **não** construir nada client-focused.
- Ruído de dados: nomes de cliente duplicados no filtro (`Agricola Alvorada`/`Agrícola
  Alvorada`/`AGRÍCOLA ALVORADA`, `Impasa`/`Inpasa`/`Inpsa`); bug de concatenação nos terminais Ongo
  (`"A R L AGRICOLA LTDAA R L AGRICOLA LTDA"`); comportamento inconsistente dos 4 cards de fonte
  (Trizy só filtra a tabela, WhatsApp abre gaveta, Ongo abre modal); mensagem de erro técnica
  vazando pro usuário final ("verifique se o Next.js está rodando"). Nenhum destes corrigido ainda
  — ver backlog.
- RAG de Inteligência de Mercado (M8) confirmado funcionando bem em produção — destacado como
  ponto forte de venda.

---

### M24 — Grupo WhatsApp de Produção + Fix Classificador (string vazia) ✅
**Entregue:** 2026-07-07

**Grupo de produção:** `GRUPOS_PERMITIDOS` (`webhook_evolution.py`) restrito a só
`"120363410106462149@g.us": "Fretes Octamove No Grain"` — removido `COA - Central Agrícola`. JID
resolvido a partir de link de convite via `GET /group/inviteInfo/octamove?inviteCode=...` (mesmo
padrão do M22, script `get_group_id.py` já existente reaproveitado).

**Bug de classificação corrigido:** `eh_cotacao` (`webhook_evolution.py`) e o critério equivalente
em `gmail_service.py` só rejeitavam o valor-sentinela exato `"Não Especificado"` — quando o GPT
devolvia string vazia `""` (em vez do sentinela) para origem/destino, isso passava como "tem rota"
e virava uma "cotação" fantasma com todos os campos em branco. Corrigido para tratar `""` igual a
`"Não Especificado"` nos dois lugares.

**Validado ao vivo com mensagem real de outro número (não a própria instância):**
- Pipeline completo confirmado ponta a ponta: webhook → GPT → Supabase → Torre.
- A correção do gate revelou, de bônus, a **primeira amostra real de mensagem "Embarque
  Liberado"** (`"Liberação de embarque Faz Sol vermelho ID 85748 Ongo- fazer confirmações"`) —
  esse tipo de mensagem virava cotação fantasma antes do fix; agora cai corretamente como aviso.
  Parser dedicado para esse tipo de mensagem segue em backlog (ver PRD 9.1), mas agora há uma
  amostra real para basear a implementação.
- Registros de teste (painel_fretes + whatsapp_timeline) removidos do Supabase após validação.

---

### M25 — Calculadora reaproveita cálculo já salvo (sem custo de API) ✅
**Entregue:** 2026-07-07

**Problema:** reabrir uma cotação já calculada (status `CALCULADA` ou além) sempre voltava com o
painel de resultado em branco — obrigava clicar "Calcular Rota" de novo, gerando chamada nova ao
QualP mesmo quando `distancia_km`/`pedagio_total_calc`/`antt_piso_por_ton` já estavam salvos na
cotação (e já apareciam corretamente no Drawer de Auditoria, que já lia esses campos direto —
só a calculadora não).

**Fix (`app/torre/calcular/[id]/page.tsx`):** novo estado `calculoSalvo`, populado em
`aplicarItem()` quando a cotação já tem `distancia_km > 0`. Novo card "Último Cálculo Salvo" (KM
Real/Pedágio/Piso ANTT) exibido acima da seção "Saídas", visível só enquanto não há resultado fresco
(`calculoSalvo && !resultado`) — mostra os números na hora, sem custo de API.

**Ressalva conhecida (comunicada ao usuário):** o mapa (polyline/pontos de pedágio) não é
persistido hoje, só os números — o mapa completo ainda exige clicar "Calcular Rota".

---

### M26 — Status otimista na Torre + Correção de infraestrutura de I/O bloqueante ✅
**Entregue:** 2026-07-07

**Sintoma reportado:** clique para mudar status de uma cotação pra "Filial" não refletia na tela.

**Investigação (não foi só teoria — reproduzido ao vivo):** testes diretos na API confirmaram que o
`PATCH /cotacoes/{id}/status` gravava certo no Supabase; o problema era só a tela não refletir.
Cruzando com o log do backend no exato segundo de uma tentativa que **deu timeout de verdade**
(reproduzido ao vivo via `curl`), achou-se o job semanal de sync ANTT rodando 6 chamadas HTTP
sequenciais na mesma janela. Investigação mais profunda revelou a causa raiz real: **múltiplos
pontos do backend faziam chamadas de I/O síncronas (bloqueantes) dentro de handlers/jobs `async`**,
travando o event loop inteiro do FastAPI (e portanto qualquer outra requisição concorrente,
incluindo o próprio clique de status) enquanto rodavam.

**Correção de infraestrutura de I/O (a pedido explícito do usuário — `asyncio.to_thread()`):**

| Arquivo | Chamada bloqueante isolada | Frequência |
|---|---|---|
| `routers/fretes.py` | Leitura Sheets + Supabase (`GET /fretes`) | a cada 5s — poll de toda aba aberta da Torre; era o offensor mais frequente, não estava na lista original do usuário mas era essencial pro fix funcionar de fato |
| `services/gmail_service.py` | Chamadas do Gmail API (`list` + `get` por e-mail) | a cada 1 min |
| `routers/cotacoes.py` | Update de status/preço/cálculo/dados (`_update`/`_update_trizy`) | a cada ação do comercial — o endpoint do bug reportado |
| `routers/webhook_evolution.py` | Gravação de cotação (`inserir_frete`) + timeline (`salvar_mensagem_timeline`) | a cada mensagem de grupo autorizado |
| `services/antt_crawler.py` | Upsert dos coeficientes ANTT (`_persistir_coeficientes`) | semanal — o gatilho que expôs o problema |

**Fix complementar na UI (`app/page.tsx`):** `updateStatus()` agora é otimista — atualiza a tela na
hora do clique e só reverte (com toast) se o PATCH realmente falhar, em vez de esperar a resposta
de rede pra refletir qualquer coisa. Timeout do proxy Next.js (`app/api/cotacoes/[id]/route.ts`)
aumentado de 5s → 15s como margem extra.

**Validado ao vivo, pós-deploy:**
- `GET /fretes` (2,3s) e `PATCH /cotacoes/{id}/status` disparados em paralelo — o PATCH voltou em
  0,64s sem esperar o `/fretes` terminar (antes, uma bloqueava a outra).
- Ciclo seguinte do Gmail (`asyncio.to_thread` na chamada mais delicada, com closures em loop)
  rodou limpo, sem erro, mesmo resultado de sempre (8 e-mails, 0 injetados/erros).
- `npx tsc --noEmit` limpo antes do deploy do frontend.

**Nota importante — comportamento por design, não bug:** quando o status vira `COTACAO_FILIAL`/
`APROV_DIRETORIA`/`RESPONDIDA`/`COTADO_AGUARDANDO`, a cotação sai do Radar ativo de propósito
(cluster "Aguardando Resposta", ver M13) — pode parecer que "sumiu" mas é comportamento esperado.

**Backlog fechado em 2026-07-07** (mesma classe de bug, frequência menor, não bloqueava o sintoma
reportado): `routers/whatsapp_timeline.py` e `services/rag_service.py` corrigidos com
`asyncio.to_thread()`, mesmo padrão. `services/sheets_service.py` era o único item que sobrou —
auditado e confirmado como código morto (nenhum handler o chama hoje), não representa risco.

---

## FASE 8 — Cérebro Central & Roteamento Omnichannel

**Contexto:** com o motor assíncrono validado no M26 (PATCH de status caindo de bloqueante para
0,64s), o usuário definiu o Master PRD completo da Fase 4 — ver PRD.md 9.5 para a visão de produto,
a decisão de "sem chat livre para o operador" e o mapa de arquivos afetados.

**⚠️ Renumeração:** a numeração original do pedido (M16/M17/M18) colidia com milestones já entregues
(`M16` Gmail Anti-Ruído, `M17` Precisão Geográfica QualP) e já reservados no backlog (`M18.1-M18.6`
Ongo transportadora). Renumerado para **M27/M28/M29**, continuando de onde a FASE 7 parou (M26).

### M27 — Ativação do Cérebro, Visibilidade e Alertas Táticos ✅
**Entregue:** 2026-07-07

**M27.1 — Cérebro Central (`torre_memoria_global`):**
- `backend/torre_memoria_global_migration.sql` (⏳ **precisa rodar em produção** — ainda não aplicada
  no Supabase, mesmo fluxo manual via SQL Editor já usado nas migrations anteriores): tabela
  `fonte`/`identificador_origem`/`entidade_cliente`/`texto_resumo`/`embedding VECTOR(1536)`, índice
  único `(fonte, identificador_origem)` (upsert em vez de duplicar ao reingerir o mesmo registro),
  índice ivfflat cosine + RPC `buscar_memoria_similar()` (mesmo padrão de `buscar_fretes_similares`,
  M8) já pronta para uso futuro (RAG cross-canal, M28.1, Paper de Índices em stand-by).
- `backend/services/memoria_global_service.py` — `indexar_memoria()` async, reaproveita o mesmo
  padrão de `rag_service.py` (embedding `text-embedding-3-small` + upsert). Disparado via
  `asyncio.create_task` (fire-and-forget, não bloqueia a resposta) em:
  - `routers/webhook_evolution.py` — cotação **e** aviso de mercado (toda mensagem de grupo
    autorizado vira fragmento; `identificador_origem` = `key.id` da mensagem Evolution).
  - `services/gmail_service.py` — todo e-mail injetado com sucesso (`identificador_origem` = 
    `msg_id` Gmail).
- `memoria_global.py` (raiz, novo) — versão **síncrona** do mesmo serviço, para os dois scripts
  locais (Trizy/Ongo rodam fora do FastAPI, via Task Scheduler): mesmo modelo de embedding, mesma
  tabela, best-effort (nunca derruba o script chamador, mesmo padrão de `whatsapp_alert.py`).
  - `trizy_extractor.py::upsert_smart()` — indexa só os BIDs **novos** do ciclo (updates não geram
    fragmento novo, já têm um da primeira ingestão).
  - `extract_ongo.py::_upsert_cargas_ongo()` — ganhou parâmetro `new_ids` (já calculado em
    `run_cycle()` para o `first_seen_cache`); indexa só os lotes genuinamente novos do ciclo.
- **Decisão de escopo:** só registros **novos** geram fragmento (não cada re-sincronização de
  registro já existente) — evita custo de embedding redundante em ciclos diários com centenas de
  linhas inalteradas, mantendo o espírito de "toda ingestão gera memória" sem desperdício.

**M27.2 — Fim do ponto cego Trizy nos KPIs:**
- Causa raiz (achado M23: "44 cotações Trizy invisíveis em Pendentes"): `totalPendentes`
  (`app/page.tsx`) só contava `status === 'PENDENTE'`, mas cotações Trizy nunca têm esse status —
  entram como `RECEBIDA` (normalização do M12, `status_crm='Novo'` → `RECEBIDA`) e só saem dali
  quando avançam pro cluster `STATUS_AGUARDANDO` ou fecham. Card "Pendentes" mostrava só
  `painel_fretes`, apesar de `cotacoes` (a lista mesclada) já incluir `trizyCotacoes` desde antes.
- Fix: `totalPendentes` redefinido como "não finalizada (Ganha/Perdida) e não no cluster Aguardando"
  — cobre `RECEBIDA`/`CALCULADA`/`PENDENTE`/sem status, de qualquer fonte. O clique no card
  "Pendentes" (`statusOk` em `cotacoesVisiveis`) foi ajustado com a mesma regra, para o filtro bater
  com a contagem do KPI.

**M27.3 — Normalização semântica de clientes:**
- `frontend-torre/lib/cliente.ts` (novo) — `chaveCliente()` colapsa por acento/caixa (NFD + strip de
  diacríticos + lowercase) e por alias explícito para os erros de digitação reais que não são só
  capitalização (`Inpasa`/`Inpsa` → `Impasa`, achado M23). `construirMapaClientes()` escolhe o
  rótulo "canônico" por chave via heurística (penaliza tudo-maiúsculo, premia acentuação).
- `app/page.tsx`: `clientesUnicos` (dropdown do filtro) e o predicado `clienteOk` passaram a usar o
  mapa canônico — `Agricola Alvorada`/`AGRÍCOLA ALVORADA`/`Agrícola Alvorada` agora aparecem como
  uma única opção no filtro e filtram todas as variantes de uma vez.

**M27.4 — Anti-zeramento do `COTADO_AGUARDANDO`:** auditado a pedido do Master PRD — **nenhum job
hoje toca status de `painel_fretes`/`octamove_extracao_trizy` à meia-noite ou em qualquer cron**.
`main.py` só agenda `gmail_job` (1min) e `antt_sync_job` (semanal, só mexe em `antt_coeficientes`);
o cron das 23:55 (`run_ongo_diario.bat` → `extract_ongo.py`/`fechamento_ongo_diario.py`) só escreve
em `cargas_ongo`/`historico_fechamentos`, nunca em `painel_fretes`. **Não havia bug ativo** — item
tratado como verificação preventiva (documentada aqui para não reabrir a dúvida numa próxima
auditoria); vira ponto de atenção real só quando M29.2 (Gatilho de Auto-Loss) for implementado.

**M27.5 — Barra de Alerta Tático:**
- `frontend-torre/app/api/torre/alertas-pendentes/route.ts` (novo, mesmo padrão REST cru contra o
  PostgREST de `app/api/trizy/cotacoes/route.ts`) — cruza `painel_fretes` (por
  `status_atualizado_em`) e `octamove_extracao_trizy` (por `criado_em`, proxy — **limitação
  conhecida:** Trizy não tem coluna própria de "última mudança de status", ver Armadilhas) filtrando
  o cluster `STATUS_AGUARDANDO` parado há mais de 3 dias.
- `app/page.tsx`: banner vermelho discreto no topo da Torre (acima dos source cards), polling 60s,
  só renderiza quando há itens. Clique aciona `abrirAlertasPendentes()` — ativa o toggle "Aguardando
  Resposta" já existente (M13) e restringe adicionalmente a um novo `Set` de IDs
  (`filtroAlertaIds`) para isolar exatamente os itens estagnados, reaproveitando toda a UI de
  resolução em lote já existente (drawer, GANHA/PERDIDA) sem duplicar componente.

**Validado:** `npx tsc --noEmit` e `npm run build` limpos em `frontend-torre` (13 rotas geradas,
incluindo `/api/torre/alertas-pendentes` nova); `python -m py_compile` limpo nos 4 arquivos backend e
nos 3 scripts locais editados/criados (`trizy_extractor.py`, `extract_ongo.py`, `memoria_global.py`).

**Migration aplicada em produção (2026-07-07):** rodada pelo usuário via SQL Editor em duas partes
(`torre_memoria_global_migration_parte1.sql` + `_parte2.sql`) — a versão original em arquivo único
falhou (`operator class "vector_c" does not exist for access method "ivfflat"`, texto truncado no
copy-paste do editor web, mesma classe de armadilha já vista em migrations anteriores) e derrubou o
`CREATE TABLE` inteiro junto por estarem na mesma transação implícita. Separado em Parte 1 (tabela +
índices essenciais + RPC, sem ivfflat) e Parte 2 (índice ivfflat isolado) — as duas rodaram com
sucesso na segunda tentativa.

**Webhook WhatsApp testado ao vivo, ponta a ponta (2026-07-07):** chamada direta de
`receber_mensagem_whatsapp()` com payload simulado do grupo autorizado (mesmo padrão de teste sem
subir servidor já usado no fix do M14/QualP). Dois ciclos:
1. **Antes da migration:** pipeline completo funcionou (texto → GPT-4o-mini → geocoding →
   `painel_fretes` + `whatsapp_timeline`); hook de memória falhou como esperado
   (`PGRST205 — Could not find the table 'public.torre_memoria_global'`), sem derrubar o webhook —
   confirma que o design best-effort funciona.
2. **Depois da migration:** mesmo teste, fragmento real gravado em `torre_memoria_global` com
   embedding de 1536 dimensões, `fonte='whatsapp'`, `entidade_cliente` resolvido corretamente pelo
   `domain_map.resolver_whatsapp()` do grupo. RPC `buscar_memoria_similar` confirmada ativa via
   chamada direta.
- Registros de teste (`painel_fretes`, `whatsapp_timeline`, `torre_memoria_global`) removidos do
  Supabase após validação, nos dois ciclos.
- **Achado de bônus (não é bug):** ao imprimir os dados no console Windows local, caracteres
  acentuados apareceram como `�` (`Rondon�polis`) — verificado byte-a-byte contra o valor real
  gravado no Supabase (`Rondonópolis`, UTF-8 correto) e confirmado que é só artefato de exibição do
  terminal cp1252, não corrupção de dado — mesma conclusão já registrada no M21 para o mojibake do
  Sheets.
- **Não testado nesta rodada:** fluxo real via Evolution API/WhatsApp de verdade na VPS (o teste foi
  chamada direta da função Python, não uma mensagem real chegando pelo webhook em produção).

### M28 — Roteamento Omnichannel e Inteligência Injetada ⚙️ parcial
**Entregue:** 2026-07-07 — só M28.1. Ver PRD.md 9.5 para a especificação completa.

**M28.1 — Botão "Sugerir Preço" (RAG Injetado) ✅:**
- `frontend-torre/app/torre/calcular/[id]/page.tsx` — `ragMedia` (média dos top-5 fechamentos
  similares, mesmo dado já buscado pra alimentar o painel "Inteligência de Mercado" — zero chamada
  de API extra) agora aparece como botão `Sugerir Preço (R$ X/t)` ao lado do label do campo "Preço
  Proposto"; clique preenche `precoTon` direto, sem digitação manual. Painel RAG (`media` local)
  refatorado para reusar o mesmo `ragMedia`, evitando cálculo duplicado.

**M28.2 — Roteamento condicional de saída por `cotacao.fonte` ❌ não iniciado:** Trizy (link direto
do BID) é trivial; Gmail (rascunho de e-mail via API) **bloqueado** — precisa escopo novo de OAuth
(`gmail.send`, hoje só `gmail.readonly`), o que exige o usuário re-autorizar a conta
`octamoveai@gmail.com` num fluxo de consentimento no navegador (não automatizável por mim). WhatsApp
(payload + disparo Evolution) é viável mas precisa de um campo novo (`remote_jid` de origem) em
`painel_fretes` — hoje só `whatsapp_timeline` guarda o grupo, não a thread/número exato pra
responder. Fica pra uma rodada dedicada.

### M29 — Automações Comerciais e Limpeza ⚙️ parcial
**Entregue:** 2026-07-07 — M29.1, M29.2, M29.3 implementados; envio real do M29.3 não testado em
produção (ver nota abaixo). Ver PRD.md 9.5 para a especificação completa.

**M29.1 — Reprecificação Semântica (Market Shift) ✅:** mesmo arquivo/mesma chamada RAG do M28.1 —
`marketShift` compara a média dos fechamentos das últimas 48h contra a média do resto da janela de
30 dias já trazida pelo RAG (sem query nova). Oscilação ≥ 10% dispara alerta visual (vermelho/alta,
azul/queda) no painel "Inteligência de Mercado" da calculadora, com os dois valores e o percentual.

**M29.2 — Gatilho de Auto-Loss ✅:** `backend/services/auto_loss_service.py` — job diário (06:00 UTC
/ 03:00 BRT, `main.py`) arquiva como `PERDIDA` cotações do cluster `STATUS_AGUARDANDO`
(`COTACAO_FILIAL`/`APROV_DIRETORIA`/`RESPONDIDA`/`COTADO_AGUARDANDO`) paradas há mais de 5 dias úteis
(`_data_limite_dias_uteis()`, conta só seg-sex). Cobre `painel_fretes` (por `status_atualizado_em`) e
`octamove_extracao_trizy` (por `criado_em`, mesma limitação documentada no M27.5/Armadilhas).
Anexa `[Auto-Loss] Expirada sem retorno após 5 dias úteis parada.` em `observacoes`/
`observacao_interna` (append, não sobrescreve) em vez de criar coluna `motivo_perda` nova — evita
mais uma migration. **É aqui que a verificação do M27.4 passa a valer de verdade**, já que este é o
primeiro job que efetivamente toca status em lote.

**M29.3 — Despertador Matinal (WhatsApp Digest) ⚙️:** `backend/services/digest_service.py` +
`backend/services/evolution_service.py` (novo, `enviar_mensagem_whatsapp()` genérico — mesmo
payload/endpoint já validado ao vivo pelo `whatsapp_alert.py` local no M22). Job diário (10:45 UTC /
07:45 BRT) consolida contagem + "valor comercial em risco" (soma de `painel_fretes.valor_total` +
`trizy.peso_toneladas × valor_proposto_ton` do cluster `STATUS_AGUARDANDO`) e dispara resumo pro
grupo autorizado (`GRUPOS_PERMITIDOS`, único hoje desde o M24). **Aproximação documentada:** "margem
financeira em risco" foi implementada como valor comercial total das cotações paradas (não a margem
líquida vs. piso ANTT) — dado mais direto de calcular sem exigir piso ANTT salvo em todas as linhas;
revisar se o time comercial achar a métrica confusa.

**Validado:** `tsc --noEmit`/`next build` limpos; `py_compile` limpo em `main.py` + 3 services
novos. `arquivar_cotacoes_expiradas()` **rodado de verdade contra produção** (0 candidatos reais
hoje — sem risco, confirmado via SELECT antes de rodar o UPDATE). `_consolidar_sync()` do digest
rodado de verdade — números reais confirmados (7 cotações, R$ 570.000,00 em risco). **Envio real
confirmado em 2026-07-08** — usuário recebeu a mensagem no grupo "Fretes Octamove No Grain" com o
formato exato esperado. M29.3 100% validado ponta a ponta.

---

### Addendum M27 — Backfill do Cérebro Central + fix de qualidade dos dados do Ongo
**Entregue:** 2026-07-07

**Backfill (`backend/backfill_memoria_global.py`, novo):** script único, idempotente
(upsert por `fonte`+`identificador_origem`, mesmo par usado pelos hooks ao vivo — pode rodar de novo
sem duplicar) que indexou o histórico já existente em `torre_memoria_global`: 103 linhas de
`painel_fretes` (WhatsApp+Gmail), 44 do Trizy, 221 do Ongo. Rodado 3x (idempotente, sem custo de
duplicar) pra cobrir timeouts pontuais de embedding — resultado final: **362/368 (98,4%)** —
Trizy 44/44, Ongo 216/221, WhatsApp+Gmail 102/103. Resíduo de 6 registros com timeout persistente,
sem impacto prático (massa histórica já robusta em todas as 4 fontes).

**Achado durante a checagem do RAG (a pedido do usuário, que notou que o Ongo gera dado todo dia):**
`historico_fechamentos` (tabela real usada pela busca RAG — não confundir com `cargas_ongo`, que é só
o snapshot bruto diário) tinha só 288 linhas, de só 2 datas (04/07 e 06/07) — o cron das 23:55 não
rodou todo dia (limitação já conhecida: depende do notebook ligado). 286 dessas 288 vinham do Ongo,
com `origem`/`destino` gravados como **código+nome de fazenda/terminal**
(`"0003123849-A R L AGRICOLA LTDA..."`) em vez de cidade/UF — o município real só existia num campo
separado (`cargas_ongo.municipio_origem`) nunca usado na montagem do texto do RAG. Isso degradava a
qualidade do match semântico do M28.1 (Sugerir Preço) especificamente pras rotas do Ongo (comparar
"Sorriso/MT" contra um código de fazenda não bate bem por cosine similarity).

**Fix (3 pontos, mesma causa raiz — só leitura de campo já existente, `cargas_ongo` em si não foi
alterado, "veracidade" do dado extraído preservada 100%):**
- `fechamento_ongo_diario.py::_agrupar_por_rota_produto()` — origem agora usa `municipio_origem`
  (fallback pro código limpo se vazio); destino tem o prefixo numérico removido
  (`_limpar_nome_terminal()`, mesmo padrão do `_strip_code_prefix()` já usado no `extract_ongo.py`).
- `extract_ongo.py` — hook do M27.1 (`_upsert_cargas_ongo()`) atualizado com a mesma lógica,
  reaproveitando `_strip_code_prefix()` já existente no módulo.
- `backend/backfill_memoria_global.py::_texto_ongo()` — mesma correção (novo helper local
  `_limpar_nome_terminal()`, já que é um script backend separado do `extract_ongo.py`).

**Validado (dry-run, só leitura):** rodada a função `_agrupar_por_rota_produto` + `_montar_texto`
contra 20 linhas reais de `cargas_ongo` — antes `"Frete de SOJA... de 0003123849-A R L AGRICOLA
LTDA... para 0003091996-COFCO..."`, depois `"Frete de SOJA EM GRAOS 2 de TESOURO para COFCO
INTERNATIONAL BRASIL S.A."` — lê como rota de verdade agora.

**Limpeza:** os 207 fragmentos do Ongo já indexados em `torre_memoria_global` com o texto antigo
foram apagados e reindexados com o texto corrigido (backfill é idempotente, sem custo extra de
duplicar as outras fontes).

**Não corrigido nesta rodada (decisão deliberada):** as 286 linhas já existentes em
`historico_fechamentos` (04/07 e 06/07) mantêm o formato antigo — `historico_fechamentos` não guarda
`link_id_carga` nem `municipio_origem`, então não dá pra corrigir essas linhas com segurança sem
arriscar inventar dado que não foi extraído junto com aquele fechamento específico. Ficam como ruído
legado; diluem-se naturalmente conforme fechamentos novos (já corrigidos) se acumulam a partir de
hoje.

---

## FASE 9 — Inteligência Competitiva Trizy & Efetividade Comercial ✅
**Entregue:** 2026-07-07

**Contexto:** dois achados da conversa pós-M29 — (1) `octamove_extracao_trizy.status_interno`
("Sem Oferta"/"Perdendo"/"Negociando"/"Encerrado"/"Operando") já era capturado e exibido como texto no
Drawer, mas não alimentava SLA/KPI/alerta nenhum — sinal de mercado competitivo desperdiçado; (2) a
normalização de cliente do M27.3 destravou uma análise que antes seria imprecisa: efetividade
comercial (taxa de conversão, ticket médio) por cliente.

### M30 — Alerta Competitivo Trizy ✅
- **Achado-chave que baratou tudo:** `/api/trizy/cotacoes` já retornava `status_trizy` em todo ciclo
  de polling (10s) — zero endpoint novo, zero mudança de backend.
- `bidsTrizyEmRisco` (`useMemo`, `app/page.tsx`) — BIDs com `status_trizy IN ('Perdendo', 'Encerrado')`
  E `status NOT IN ('GANHA', 'PERDIDA')` (não alerta sobre BID que já fechamos por conta própria).
- Banner laranja (distinto do vermelho do M27.5 — é urgência de mercado externo, não SLA interno),
  reaproveita o `filtroAlertaIds` já existente do M27.5.
- **Fix necessário no meio do caminho:** o gate de "oculta cluster Aguardando por padrão"
  (`cotacoesVisiveis`) rodava *antes* do `filtroAlertaIds` — um BID "Perdendo" que já estivesse em
  `COTACAO_FILIAL` (cluster Aguardando) sumiria do clique do alerta. Corrigido: quando
  `filtroAlertaIds` está ativo, ele passa a ter prioridade total (bypassa o ocultamento de cluster),
  já que um alerta tático aponta exatamente os ids relevantes, independente da etapa do funil —
  correção vale tanto pro M27.5 quanto pro M30.

### M31 — Painel de Efetividade Comercial por Cliente ✅
- Novo componente `EfetividadeModal` (`app/page.tsx`, mesmo padrão visual do `OngoGeralModal`) —
  agregação 100% client-side (`useMemo`) sobre `cotacoes` (WhatsApp+Gmail+Trizy — **Ongo Geral fica
  de fora**, mede volume de mercado bruto, não cotação nossa), usando o cliente já normalizado pelo
  M27.3 (`mapaClientes`/`chaveCliente`) — sem essa dependência, "Agrícola Alvorada" contaria 3 vezes.
- Métricas por cliente: total, ganhas, perdidas, em andamento, taxa de conversão
  (`ganhas / (ganhas + perdidas)`), ticket médio (preço médio das GANHAS).
- Resumo no topo: taxa de conversão geral da carteira, cliente com melhor conversão (mínimo 2
  desfechos pra não destacar outlier de amostra 1), total de cotações no período.
- Filtro de período (30/60/90 dias / tudo) — filtra por `criado_em`.
- Acesso via botão dedicado no header ("Efetividade Comercial") — não é source card, é visão
  analítica, não fonte de ingestão.
- **Nota de GTM (fora de escopo agora):** mesma lógica serviria pra medir efetividade por
  transportadora parceira se/quando virar produto B2B2B pras 38 transportadoras da estratégia GTM.

**Validado:** `npx tsc --noEmit` e `npm run build` limpos (13 rotas, sem rota nova — M30/M31 são
100% frontend, sem endpoint novo). Deploy feito na VPS (`deploy_vps.py`), health check OK.

**Testado ao vivo no navegador (Puppeteer, VPS real, 2026-07-07) — os dois com dado real:**
- **M30:** banner apareceu de cara com **13 BIDs Trizy em risco** (dado real, não estimado). Clique
  filtrou o Radar pra exatamente os 13 (card Trizy BID + dropdown Origem do Dado ficaram ativos).
  Aberto um BID (`#00067435`, SIPAL INDUSTRIA) na Auditoria: `Status Trizy: Encerrado`, `status`
  ainda `Recebida` — bate exatamente com o filtro do alerta.
- **M31:** aberto com dado real — 74 cotações, 18 clientes distintos, taxa de conversão geral 100%
  (1 ganha/0 perdidas). "Impasa" aparece como uma única linha (não split em Impasa/Inpasa/Inpsa) —
  confirma que a normalização do M27.3 alimenta essa agregação corretamente. "Melhor Conversão"
  mostrou "sem dado suficiente" corretamente (só 1 fechamento real no sistema até agora, abaixo do
  mínimo de 2 desfechos pra evitar destacar outlier de amostra 1). Filtro de período (30/60/90d)
  trocou de aba sem erro — números idênticos nos 3 porque todo o dataset tem ~2 semanas (nada mais
  antigo pra diferenciar ainda, não é bug).
- **Achado no teste (não é bug do M30/M31):** ao testar o fechamento do Drawer via clique
  programático, dois modais (Drawer + Efetividade) ficaram abertos simultaneamente — são estados
  React independentes (`drawerItem` / `efetividadeOpen`), então não há exclusão mútua entre eles.
  Não trava nem quebra nada, só empilha visualmente; não é um caso de uso real (usuário não abre os
  dois de propósito), então não foi tratado como bug — anotado caso vire irritante na prática.

### M31.1 — Efetividade Comercial promovida de modal pra aba própria ✅
**Entregue:** 2026-07-08

**Motivação (feedback do usuário):** um modal com presets fixos (30/60/90d/tudo) é uma visão
passageira; pra virar ferramenta de gestão de verdade (o dono medindo o time comercial ao longo do
tempo, "vender visão e decisão baseada em dado"), precisa ser uma seção permanente com filtro de
data real, não só atalhos fixos. Confirmado com o usuário que a métrica é **por time/funil**, não
por vendedor individual — a Torre não tem login/autenticação hoje, então atribuição por operador
individual ficaria fora de escopo (exigiria construir autenticação do zero).

**Mudanças:**
- Nova rota `frontend-torre/app/torre/efetividade/page.tsx` — página própria (mesmo padrão de
  `torre/calcular/[id]`: header fino com botão "← Radar", busca os próprios dados via
  `/api/fretes` + `/api/trizy/cotacoes`, não depende mais do estado da página principal).
  `EfetividadeModal` removido de `app/page.tsx`; botão do header agora faz
  `router.push('/torre/efetividade')`.
- **Filtro de data real** (`<input type="date">` De/Até) além dos presets rápidos (7/30/60/90
  dias, que só preenchem os dois inputs) — dá pra escolher qualquer intervalo exato, não só janelas
  fixas contadas a partir de hoje.
- `isLixoCotacao()` extraído de `app/page.tsx` pra `lib/cotacao.ts` (novo) — compartilhado entre a
  página principal e a nova rota, evita duplicar a lógica de "cotação fantasma".

**Validado ao vivo (Puppeteer, VPS real):** nova URL renderiza com header próprio; preset "7 dias"
mudou os inputs de data pra `01/07/2026 – 08/07/2026` e recalculou de **74 cotações/18 clientes**
(janela "Tudo") pra **7 cotações/5 clientes** — confirma que o filtro de data funciona de verdade,
não é só cosmético.

---

## FASE 10 — Valor pra Transportadora (Ongo) — planejado, não iniciado

**Origem:** Varredura Clínica do Portal Ongo (PRD.md §9.2, 2026-07-04) — seis oportunidades de dado
nativo do portal `painel.ongocargas.com.br` que hoje **não são extraídas** (`extract_ongo.py` só
cobre `/carregamentos` e `/agendamentos`), cada uma vendável como inteligência pra transportadora
(estratégia GTM confirmada — ótica da transportadora, nunca do embarcador, ver
[[project_torre_gtm_estrategia]]). Renumerado de `M18.1-M18.6` (rótulo antigo do backlog) pra
`M32-M37`, continuando a numeração real do projeto (parou em M31).

**Decisões de arquitetura (atualizadas em 2026-07-08 após revisão do usuário), valem pras seis:**
- **UI — revisado:** `extract_ongo.py` já empurra pra **7 abas do Sheets** hoje (Carregamentos,
  Agendamentos, Aderência, Lances, Análise por Oferta, Histórico, Análise Mensal, AUDITORIA) — já
  existe um sistema de relatório dentro do Sheets, não é um sistema novo. Decisão: as novas abas do
  M32-M37 seguem esse mesmo padrão (Python computa/formata, empurra pra aba nova), e o **dashboard em
  si é montado no Looker Studio** (gratuito, Google) conectado direto nessas abas — em vez de React
  customizado por métrica. Botão "Abrir Dashboard" na Torre passa a abrir o relatório Looker
  (embed ou link); "Ver Planilha" continua abrindo a aba crua por trás, mesmo padrão de escape hatch.
- **⚠️ Looker só exibe, não dispara ação:** a lógica de gatilho do M32 (alerta) e do M36 (disparo
  WhatsApp) continua tendo que rodar em Python (`extract_ongo.py`/cron), independente da escolha de
  dashboard — Looker não substitui isso, só a camada de visualização/filtro.
- **Dado:** Supabase segue como fonte de verdade só onde precisa de cruzamento que o Sheets não faz
  bem (ex.: Score por CPF do M35, que depende do M33); o resto vive só no Sheets+Looker.
- **"Tempo real" com ressalva:** reflete o último ciclo de extração do `extract_ongo.py` — não é uma
  tela viva atualizando sozinha o dia inteiro, porque o scraper não é um serviço sempre ligado.
- **Risco anti-bot — decisão (2026-07-08):** mesma lógica do stand-by do Trizy Lance — não vale
  endurecer produção pra uma conta que não é cliente pagante ainda (`Nova Frota`). O scraping novo
  do M32-M37 roda **manual/sob demanda** por enquanto, fora do cron automático das 23:55; cada aba
  nova é testada manualmente primeiro (observando se dá CAPTCHA/bloqueio) antes de cogitar automatizar.
  O investimento "de verdade" em anti-bot (proxy residencial + Scrapling no Ongo) fica adiado até
  existir cliente pagante que dependa disso em produção.

**Prioridade recomendada (herdada do audit original — impacto x esforço):**

### M32 — Alerta "Sem Localização" ✅
**Entregue:** 2026-07-08

**Descoberta técnica (exploração única, 1 login, ver nota de risco abaixo):** o widget nativo
"Sem Localização" do Dashboard Ongo é alimentado por
`v2/api/DashboardCargas/listagem-all-dashboard-geolocations` — cada registro já vem com um campo
`isOffline` (booleano, calculado pelo próprio Ongo) — não precisei inventar um limiar de horas por
conta própria, só usar o critério que o portal já usa.

**Implementado (`extract_ongo.py`):**
- `_fetch_geolocations()` — **v2, corrigida em 2026-07-08 após diagnóstico ao vivo** (ver abaixo).
- `_detectar_sem_localizacao()` — pega o ping mais recente por `idFrete`, filtra `isOffline=true`.
- Alerta via `whatsapp_alert.py::alertar_sem_localizacao()` (nova função, reaproveita o mesmo
  `_enviar_texto()` — refatorado de dentro de `alertar_falha` pra não duplicar a chamada HTTP).
- Aba "Sem Localização" no Sheets (full-refresh a cada ciclo) — fonte pro Looker Studio.
- **Sem tabela Supabase nova** — é estado momentâneo (snapshot), não precisa de histórico acumulado
  como o M34 precisa.

**Teste ao vivo (2026-07-08) achou um bug real:** rodei `extract_ongo.py` de verdade (modo monitor
contínuo, 6 varreduras) — ciclo principal, M34 e tudo mais funcionaram perfeitamente, mas o M32
reportou **0 caminhões sem localização em todas as 6 varreduras**, divergindo do "10" visto ao vivo
no widget do Dashboard horas antes. Investigação dedicada (`diag_m32.py`, script descartável, 1 login
a mais reaproveitando `_login`/`_fetch_lista` reais): a v1 de `_fetch_geolocations()` tentava
**replicar** a chamada via `fetch()` cru dentro do browser, usando os headers de auth capturados por
`_fetch_lista()` — a API respondia `200 OK` com `"success": true, "data": []` (vazio, sem erro),
porque **esse endpoint só populua de verdade quando o próprio JS do Dashboard o dispara** ao carregar
o widget "Cargas no Mapa", não quando chamado manualmente de fora.

**Fix:** `_fetch_geolocations()` reescrita pra escutar passivamente a resposta (`page.on("response")`)
enquanto navega de verdade pro Dashboard (`PAINEL_URL`) — exatamente o mesmo padrão comprovado que
`_fetch_lista()` já usa pro `/carregamentos`. Não depende mais de `api_headers` (removido da
assinatura). Isso adiciona uma navegação extra ao Dashboard por ciclo (poucos segundos).

**Validado:** lógica de detecção (`_detectar_sem_localizacao`) testada offline com dado sintético —
correta. `python -m py_compile` limpo após o fix. **Re-testado ao vivo em 2026-07-08 via
`run_ongo_once.py`** (pedido do usuário, 5ª sessão do dia): confirmado — `M32: 30 caminhão(ões) sem
localização` (antes do fix: 0 em 6 varreduras seguidas). Alerta WhatsApp disparado de verdade com a
lista (limitada aos 10 primeiros). M32 está **100% funcional e validado ponta a ponta**.

### M33 — Extrator "Fretes Cancelados" + "Troca de Nota" — não iniciado
**Fonte:** duas seções não cobertas — Relatórios Administrativos > Fretes Cancelados (~18%/semana na
amostra) e aba Troca de Nota (~35%/semana cancelada na amostra).
**Bloqueio técnico:** URLs tentadas (`/troca-de-nota`, `/relatorios`) redirecionaram de volta pro
Dashboard na exploração de 2026-07-08 — não são os slugs corretos. Precisa de uma exploração mais
dirigida (clicar pelo menu real da UI, não adivinhar URL) antes de implementar.

### M34 — Score de Compliance de Descarga ✅
**Entregue:** 2026-07-08

**Descoberta técnica:** endpoint `v1/api/Frete/listagem-analise-descarga/{pageSize}/{pageIndex}/
{dataIni}/{dataFim}/null/null/null/null` — retorna exatamente os campos do achado original
(`desligouLocalizacao`, `substituicaoFotoDescarga`, foto do canhoto) por descarga, com um array
`children` (1 carga pode ter múltiplos destinos).

**Implementado (`extract_ongo.py`):**
- `_fetch_analise_descarga()` — mesma técnica de `page.evaluate(fetch)` com headers reaproveitados,
  janela de 4 dias por padrão.
- `_map_descarga_rows()` — achata `children` em linhas simples pro Sheets.
- **Decisão de veracidade:** os campos booleanos (`Desligou Localização`, `Substituiu Foto`, `Tem
  Foto`) são expostos crus (Sim/Não) — **não inventei** a fórmula do score "X/4" visto na UI do
  portal, já que não confirmei o cálculo exato; melhor mostrar os componentes reais do que uma
  pontuação adivinhada.
- `_upsert_descarregamentos()` + `backend/ongo_descarregamentos_migration.sql` (tabela nova, dedup
  por `id_cotacao+id_frete_destino`) — Supabase aqui sim, porque o valor real é o score agregado por
  motorista/transportadora **ao longo do tempo**, que o Sheets sozinho não calcula bem.
- Aba "Descarregamentos" no Sheets — fonte pro Looker Studio.
- Vendável separadamente ao embarcador como "auditoria terceirizada" (nota: exceção à regra "sempre
  ótica transportadora", já registrada no PRD).

**Validado:** lógica testada offline com dado sintético no schema real confirmado — `_strip_code_
prefix` limpou corretamente origem/destino (`"0003161628-FAZENDA BOM TEMPO"` → `"FAZENDA BOM
TEMPO"`). `python -m py_compile` limpo. Testado ao vivo via `extract_ongo.py`/`run_ongo_once.py`
(múltiplas rodadas 2026-07-08) — capturou dado real (4-14 linhas por ciclo) consistentemente.
**Migration `ongo_descarregamentos_migration.sql` aplicada em produção em 2026-07-08** — tabela
confirmada via SELECT direto (0 linhas, aguardando o próximo ciclo real gravar). Upsert deve
funcionar limpo agora (a única falha anterior era "tabela não existe").

**⚠️ Nota de risco (por que M32/M34 não foram testados ao vivo nesta rodada):** a exploração inicial
(1 login) funcionou e trouxe os dois endpoints acima com sucesso. Uma segunda tentativa de sessão,
logo em seguida, **falhou no login** (campo de usuário não apareceu a tempo) — sinal possível de
fricção anti-bot por sessões consecutivas rápidas demais, exatamente o risco que a decisão de
"manual/sob demanda" (acima) já antecipava. Por precaução, não insisti numa terceira tentativa.
Validação ao vivo fica pro usuário rodar quando achar oportuno (`python extract_ongo.py`), não no
cron automático das 23:55 ainda.

### M35 — Score de Confiabilidade por CPF de Motorista
**Fonte:** cadastro Autônomos (405 motoristas, CPF, nome, proprietário — hoje isolado do resto).
**Escopo:** cruzar CPF com histórico de cancelamento/reagendamento (dado do M33) pra pontuar risco por
indivíduo, não só agregado por transportadora. Depende do M33 já estar rodando (precisa do histórico
de cancelamento pra cruzar).

### M36 — Disparo Automático pro Motorista Parado
**Fonte:** relatório "Aguardando Descarregamento" (nome, CPF, celular, placa, "Ticket em análise").
**Escopo:** WhatsApp direto pro **celular do motorista** (não pro grupo interno — é um destinatário
novo, fora do padrão de automação usado até aqui). **Ressalva de design:** mandar mensagem não
solicitada pro número pessoal de terceiro tem implicação de consentimento/spam diferente de avisar o
próprio grupo interno.
**Decisão confirmada (2026-07-08):** construir o botão "Disparar Cobrança" no dashboard **sem função
real por trás** (UI/placeholder) — fica visível mas inerte até o usuário decidir "ligar o fio" de
acordo com o que cada cliente pedir. Não automatizar disparo sem supervisão nesta fase.

### M37 — Auditar `LANCES_URL` morta
Item de higiene técnica, não milestone de valor de negócio — `/lances` não responde pra este tipo de
conta (redireciona pro Dashboard, achado já confirmado no código: `page.goto(LANCES_URL, ...)` em
`extract_ongo.py:718`). Só confirmar se é código morto e remover, ou gatear por tipo de conta.

### M38 — Robustez do Monitor Contínuo pra Produção 24/7 — planejado, não iniciado
**Contexto (2026-07-08):** produção precisa do monitor contínuo (`extract_ongo.py::main()`, ciclo de
5 em 5 min — **não** o cron único `run_ongo_once.py` das 23:55) rodando o dia inteiro, porque o Ongo
é muito dinâmico. Isso muda o perfil de risco: não é mais "1 login por dia", é "1 login vivo por
muitas horas seguidas, com o processo tendo que sobreviver e se recuperar sozinho".

**⚡ Fixes de baixo risco já aplicados hoje (não esperam o milestone):**
- **Alerta WhatsApp no monitor contínuo** — `main()` não tinha `alertar_falha()` em nenhum dos
  `except` (só o `run_ongo_once.py` tinha); agora ambos os pontos de falha (re-login e erro geral de
  varredura) alertam de verdade, mesma função já usada em todo o resto do projeto.
- **Pausa de 20s antes do re-login automático** — antes, uma sessão expirada disparava re-login
  *imediato*, o mesmo padrão (login logo após outro) que causou a fricção real observada em
  2026-07-08 (2ª tentativa de exploração falhou). Não elimina o risco, só para de empilhar tentativas
  rápidas sem necessidade.

**🔜 Camadas maiores — desenhadas, aguardando decisão de implementação:**
1. **Supervisão de processo (o gap mais sério hoje):** se o processo Python morrer por inteiro (não
   uma exceção tratada, um crash duro do Chromium, o processo ser fechado, etc.), nada reinicia
   sozinho. Duas opções:
   - Windows Task Scheduler nativo — a própria tarefa agendada tem opção "reiniciar a cada X min se
     falhar, até Y vezes" (config, não código).
   - NSSM (Non-Sucking Service Manager) — roda como serviço Windows de verdade, reinicia sozinho,
     sobrevive até sem usuário logado. Mais robusto, mais setup.
2. **Reciclagem preventiva do browser/sessão** — hoje 1 browser fica vivo por horas/dias seguidos
   (bom pra evitar logins repetidos, mas Chromium headless pode acumular memória em sessões muito
   longas). Reiniciar browser+login a cada N horas (ex.: 6-12h) como manutenção programada, não só
   reativamente quando já quebrou — também renova o token de sessão antes dele expirar sozinho.
   **Cuidado:** isso em si gera um login novo a cada recycle, então precisa de um intervalo generoso
   pra não recriar o problema que estamos tentando evitar.
3. **Heartbeat externo** — uma checagem simples (ex.: "o `ongo_log.json` não foi atualizado há mais
   de 15 min?") pra pegar o caso raro de tudo travar silenciosamente mesmo com as camadas acima.
4. **Config de energia/rede da máquina local** — provavelmente a causa mais provável de interrupção
   no dia a dia (mais que anti-bot): notebook dormir/hibernar ou perder Wi-Fi. Não é código, é
   configuração do Windows (nunca dormir, sempre na tomada, Wi-Fi sem economia de energia) — mas é
   pré-requisito real pra rodar 24/7 local.

**Decisão registrada (2026-07-08):** não implementar as camadas 1-4 agora — documentar como
milestone e decidir a ferramenta (Task Scheduler vs. NSSM) numa sessão dedicada antes de produção
de verdade depender disso.

### M39 — Dashboard Unificado do Ongo dentro da Torre ✅
**Entregue:** 2026-07-08

**Contexto — pivô de arquitetura:** a ideia original (2026-07-08, mais cedo) era Looker Studio
conectado nas abas do Sheets pro dashboard do M32/M34. Usuário sentiu fricção real na UI de
arrastar-e-soltar do Looker; cogitamos Metabase como alternativa (conecta direto no Postgres,
UI mais simples). O usuário então trouxe a ideia vencedora: **em vez de ferramenta nova, estender o
menu de abas que já existe** no `OngoGeralModal` (Ao Vivo/Histórico, desde o M21) com mais abas —
zero ferramenta nova, zero página nova, reaproveita 100% da infraestrutura já validada.

**Implementado:**
- **Aba "Ao Vivo" redesenhada:** colunas mais compactas (`px-2 py-1.5` em vez de `px-3 py-2`,
  headers encurtados — "Município Origem"→"Município" etc.) pra abrir espaço sem exigir mais scroll
  horizontal do que já existia.
- **Nova coluna "% Lote"** — `(quantidade_kg - saldo_restante_kg) / quantidade_kg * 100`, mesma
  fórmula do "% Completado" que já existia só no Histórico, agora também na Ao Vivo. 100%
  client-side, zero mudança de backend (os campos já vinham na `cargas_ongo`).
- **Nova coluna "Entrada Ongo"** — resposta à pergunta do usuário ("tem a data que a oferta caiu no
  Ongo?"): **sim, já existia** (`first_seen_cache`, usado desde o M9/M15 só pra coluna "Data Entrada
  Ongo" do Histórico), só não estava exposta na Ao Vivo/Supabase. Adicionado:
  - `extract_ongo.py::_upsert_cargas_ongo()` ganhou parâmetro `first_seen_cache`, grava
    `data_entrada_ongo` (texto cru, formato `dd/mm/aaaa hh:mm`, mesmo do cache) em cada linha.
  - Migration `backend/ongo_data_entrada_migration.sql` (`ALTER TABLE cargas_ongo ADD COLUMN
    data_entrada_ongo TEXT`) — ⚠️ **registrada aqui como aplicada por engano, mas nunca rodou de
    fato em produção** (achado M39.3, ver abaixo); coluna confirmada inexistente no banco em
    2026-07-09.
  - **Limitação conhecida:** ainda não existe "data de conclusão" (quando o lote terminou de
    carregar) — só a de entrada. Daria pra cruzar "entrada 13h dia X, concluído mesmo dia" (exemplo
    do usuário) só com a entrada + o `status` atual; rastrear o momento exato da conclusão exigiria
    uma nova cache tipo `first_seen_cache` só que pra transição de status → "Concluída", não
    implementado nesta rodada (escopo deliberadamente cortado, ver Backlog).
- **Aba "Sem Localização" (M32) nova** — `backend/services/sheets_reader.py::listar_aba()` (função
  genérica nova, lê qualquer aba pelo nome usando a 1ª linha como cabeçalho — não hardcoded feito o
  `listar_historico`) + endpoint `GET /api/ongo-geral/sem-localizacao` (`ongo_historico.py`) + proxy
  Next.js. Lê do Sheets (snapshot do último ciclo, mesmo dado que já existia).
- **Aba "Descarregamentos" (M34) nova** — lê **direto do Supabase** (`ongo_descarregamentos`), não
  do Sheets — é a fonte que de fato acumula histórico entre ciclos (Sheets é full-refresh, mostra só
  o último ciclo). Novo `app/api/ongo-geral/descarregamentos/route.ts` (mesmo padrão REST cru já
  usado em `/api/ongo-geral/route.ts`). Inclui resumo agregado por motorista (client-side,
  `useMemo`) — % com foto, % desligou localização, clicável pra filtrar a tabela detalhada.

**Validado ao vivo (Puppeteer, VPS real, 2026-07-08):**
- 4 abas visíveis no menu: Ao Vivo / Histórico / Sem Localização / Descarregamentos.
- Ao Vivo: `% Lote` calculando certo com dado real (42%, 96% em linhas reais); `Entrada Ongo` vazio
  corretamente (nenhum ciclo rodou desde a migration — vai popular no próximo).
- Sem Localização: dado real do teste de hoje (10:24), linhas com Data Captura/ID Frete/ID
  Caminhão/Último Ping/Status Frete populadas.
- Descarregamentos: estado vazio correto ("Sem dado ainda"/"Nenhum descarregamento registrado
  ainda") — tabela só foi criada depois do último ciclo real, comportamento esperado, não é bug.

**Validado:** `npx tsc --noEmit` e `npm run build` limpos (16 rotas, +2 novas:
`/api/ongo-geral/sem-localizacao`, `/api/ongo-geral/descarregamentos`). `python -m py_compile` limpo
em `sheets_reader.py`/`ongo_historico.py`/`extract_ongo.py`/`main.py`. Deploy feito na VPS, health
check OK.

### M39.1 — Bug crítico: `cargas_ongo` acumulava lotes "fantasma" pra sempre ✅
**Entregue:** 2026-07-08 (achado pelo usuário, poucas horas após o M39 subir)

**Sintoma:** usuário comparou a 1ª linha do Sheets com a 1ª linha da Torre — dado completamente
diferente. Contagem também batia errado: Sheets com 128 linhas reais, Torre mostrando 248 "ofertas".

**Causa raiz:** `_upsert_cargas_ongo()` sempre fez só `upsert` (insere/atualiza), **nunca `delete`** —
um lote que sai da lista ativa do Ongo (carregado, cancelado, expirado) nunca foi removido da tabela
`cargas_ongo`, ficando fantasma pra sempre. Diferente do Sheets, que já fazia full-refresh
(`_write_ws` → `ws.clear()` a cada ciclo). Confirmado com dado real: dos 248 lotes na tabela, só 128
tinham o timestamp do ciclo mais recente — os outros 120 eram de ciclos entre 02/07 e 07/07, já
inativos.

**Fix (`extract_ongo.py::_upsert_cargas_ongo`):** depois do upsert, `DELETE FROM cargas_ongo WHERE
link_id_carga NOT IN (<ids do ciclo atual>)` — mesmo comportamento full-refresh que o Sheets já tem.
**Limpeza imediata:** os 120 fantasmas existentes foram removidos direto via Supabase (sem precisar
de novo ciclo do Ongo) — tabela confirmada em 128 linhas na hora.

**Dois ajustes de UX pedidos junto (mesmo achado):**
- Coluna **"Empresa" → "ID Ongo"** na aba Ao Vivo — o dashboard é de uma transportadora só
  (Agrícola Alvorada sempre), então "Empresa" era sempre o mesmo valor, sem informação nenhuma;
  `link_id_carga` é o dado útil ali.
- **Alerta visual no "% Lote"** — saldo restante abaixo de um mínimo viável de carga (nenhum
  caminhão real pega, ex.: 2.000 kg) agora aparece em **vermelho com ⚠**, em vez de parecer só "mais
  um pouco pra completar". Limiar usado: **7.000 kg** (abaixo do menor caminhão comum, "Toco",
  ~7-8t) — valor conservador, ajustável se o usuário quiser outro corte.

**Validado ao vivo (Puppeteer, VPS real):** Total de Lotes = **128** (bate exato com o Sheets);
Volume Liberado Total = **156.294.858 kg** (bate exato com a soma manual do usuário, 156.294,858);
coluna "ID Ongo" mostrando IDs reais (329160, 329163); lote 329163 (50.000kg/2.000kg saldo) mostrando
**"96% ⚠" em vermelho**, exatamente o exemplo dado pelo usuário.

### M39.2 — Auditoria de tabelas espelho: mesmo bug no Trizy + arquivo errado editado ✅
**Entregue:** 2026-07-08 (pedido do usuário: "Verifica outras tabelas espelho que podem ter o mesmo bug")

**Achado 1 — `octamove_extracao_trizy` tinha o mesmo padrão do M39.1:** `upsert_smart()` só fazia
insert/update, nunca removia BID que saiu da lista ativa do Trizy — inflava os KPIs de "Pendente" pra
sempre. Fix **diferente** do Ongo aqui: BID carrega dado nosso (`status_crm`, `valor_proposto_ton`,
`observacao_interna`), então em vez de `DELETE` a linha é marcada `status_crm = "PERDIDA"` com nota
automática em `observacao_interna`, preservando histórico. BID já `GANHA`/`PERDIDA` não é tocado.

**Achado 2 — existiam DUAS cópias de `trizy_extractor.py` no disco**, e as edições de hoje (hook
M27.1 do Cérebro Central + o fix acima) foram feitas por engano na cópia errada:
- `C:\Users\Dell\trizy_extractor.py` — rascunho **v2** abandonado (293 linhas, sem busca de detalhe,
  sem auto-renovação de token). Não usado em produção — confirmado via Task Scheduler (nenhuma
  tarefa agendada pra Trizy existe; extração roda manual/sob demanda).
- `no-grain-os/scrapers/trizy/trizy_extractor.py` — script **v5 real** (595 linhas, data de
  modificação 30/06 batendo exato com a entrega do M9), com busca de detalhe por negociação,
  auto-renovação de token via Scrapling em caso de HTTP 401, todos os campos mapeados.

Os dois fixes (hook M27.1 + marca-PERDIDA de fantasma) foram **reaplicados no arquivo v5 real**, que
é quem de fato roda. O arquivo v2 na raiz foi marcado com aviso `[DEPRECATED]` no cabeçalho (não
usar) mas não foi apagado — mantido só por segurança, sem confirmação do usuário para exclusão.
`python -m py_compile` limpo no v5 corrigido.

**Achado 3 — outras tabelas checadas, sem o mesmo bug:** `antt_coeficientes`, `toll_plazas`/
`toll_rates` e `maplogis_cache` são dado de referência/cache genuíno (não espelho de uma lista ativa
que encolhe), não precisam do mesmo tratamento. Nenhuma outra tabela com o padrão "upsert sem delete
de um espelho de lista externa" foi encontrada.

### M28.2b (parcial) — Link Trizy na calculadora + fix cidades duplicadas (Ongo) ✅
**Entregue:** 2026-07-08

**Cidades duplicadas — causa raiz:** filtro "Município Origem" da aba Ao Vivo (`OngoGeralModal`) usava
`Array.from(new Set(rows.map(r => r.municipio_origem)))` sobre string crua — o cadastro do Ongo tem
inconsistência de digitação na origem (`"QUERENCIA"` sem acento e `"QUERÊNCIA"` com acento no mesmo
município), então viravam duas entradas no dropdown. Mesma classe de bug já resolvida pra cliente no
M27.3 (`lib/cliente.ts`).

**Fix:** extraída a lógica de normalização (`semAcento`/chave/heurística de melhor rótulo) do
`lib/cliente.ts` para um util compartilhado `lib/normalizacaoTexto.ts`; criado `lib/municipio.ts`
(`chaveMunicipio`, `construirMapaMunicipios`) reaproveitando o mesmo util. Aplicado no `useMemo` de
`municipios` e no filtro `filtradas` do `OngoGeralModal`. `terminal_origem`/`empresa` têm a mesma
exposição estrutural mas não foram tocados agora (não reportados) — candidatos a mesmo tratamento se
o usuário confirmar duplicata neles também.

**M28.2a — link Trizy na calculadora:** investigação confirmou que `negociacaoId` (identificador do
BID individual) **não é persistido** em `octamove_extracao_trizy` — é descartado depois de buscar o
detalhe, tanto no `scrapers/trizy/trizy_extractor.py` quanto no `scrapers/trizy-actor/`. E não há no
código nenhuma URL de detalhe do BID confirmada (só a URL-base da lista, `bid.trizy.com.br/cotacao-
frete`, usada de fato em navegação real no actor). Implementado o que é seguro sem inventar URL:
botão "Abrir no Trizy" no header da calculadora (`torre/calcular/[id]/page.tsx`), visível só quando a
cotação carregada veio do Trizy (`isTrizy`, setado no fallback de fetch pra `/api/trizy/cotacoes`),
linkando pra lista real de BIDs. **Deep-link pro BID específico fica pendente** — precisaria (1)
confirmar o padrão real da URL de detalhe inspecionando o app da Trizy no navegador, e (2) persistir
`negociacaoId` como coluna nova em `octamove_extracao_trizy` nos dois scrapers.

**Validado ao vivo (Puppeteer, VPS real):** dropdown de município com 32 opções, `"Querência"`
aparecendo uma única vez (sem duplicata "QUERENCIA"). Botão "Abrir no Trizy" renderizado na
calculadora carregada com BID real (`00067487`), `href` confirmado = `https://bid.trizy.com.br/
cotacao-frete`. `npx tsc --noEmit` e `npm run build` limpos (16 rotas). Deploy feito, health check OK.

### M39.3 — Bug crítico: migration `data_entrada_ongo` nunca foi aplicada, sync do dia inteiro travado ✅
**Entregue:** 2026-07-09 (achado pelo usuário: "sheets 132 ofertas ... ao vivo 128 ofertas")

**Sintoma:** usuário comparou contagem do Sheets (132 ofertas, atualização 08/07 23:55) com a aba Ao
Vivo da Torre (128 ofertas) e notou divergência — mesmo padrão de sintoma do M39.1, mas causa raiz
diferente desta vez.

**Causa raiz:** a migration `backend/ongo_data_entrada_migration.sql` (`ALTER TABLE cargas_ongo ADD
COLUMN data_entrada_ongo TEXT`), registrada no M39 como "aplicada em produção pelo usuário", **nunca
rodou de fato** — confirmado com `SELECT data_entrada_ongo FROM cargas_ongo` retornando erro real de
schema do Postgres (`42703 column ... does not exist`, não um erro de cache do PostgREST, que seria
`PGRST204` — a distinção importa: `42703` prova que a coluna não existe na tabela de verdade).
Como `_upsert_cargas_ongo()` desde o M39 sempre inclui `data_entrada_ongo` no payload, **todo upsert
desde então vinha falhando** — confirmado no `ongo_cron.log` de 08/07 23:56: `ERRO ao sincronizar
cargas_ongo no Supabase: {'message': "Could not find the 'data_entrada_ongo' column...", 'code':
'PGRST204'}`. A falha era só logada (try/except interno em `_upsert_cargas_ongo`, silencioso por
design pra não derrubar o ciclo do Sheets — comentário original: "Nunca deve derrubar o ciclo do
Sheets"), sem alerta WhatsApp, então passou despercebida: Sheets seguiu perfeito (132, fresco),
`cargas_ongo`/Torre ficou parada na última sincronização bem-sucedida antes do bug (128 linhas,
timestamp único `2026-07-08T14:25:42`, de uma sincronização manual anterior nesta mesma sessão).

**Fix:**
1. Migration reconfirmada correta (não precisou reescrever) — **entregue ao usuário pra rodar de
   verdade desta vez** no SQL Editor do Supabase.
2. `extract_ongo.py::_upsert_cargas_ongo()` — adicionado `alertar_falha()` no `except` que já existia,
   pra esse tipo de falha silenciosa nunca mais passar 1 dia inteiro sem ninguém perceber (mesmo
   padrão do M38, só que faltava aqui especificamente).

**Sem novo login necessário:** a migration não mexe no scraper/Ongo — só schema do Supabase. Depois
de aplicada, o próprio cron diário das 23:55 (`run_ongo_diario.bat` → `run_ongo_once.py`) resincroniza
sozinho na próxima execução, sem precisar rodar nada manual agora.

---

## PRÓXIMOS MILESTONES (Backlog)

| # | Milestone | Descrição | Prioridade |
|---|-----------|-----------|------------|
| ~~—~~ | ~~Rodar `ongo_data_entrada_migration.sql` de verdade~~ | ✅ Resolvido em 2026-07-09 — migration aplicada de fato no SQL Editor do Supabase (coluna `data_entrada_ongo` confirmada via REST API), ciclo manual (`run_ongo_once.py`) rodado em seguida pra resincronizar (139 lotes, sem erro `PGRST204`), e conferido ao vivo no navegador: aba Ao Vivo da Torre bateu com Sheets (139 registros) | — |
| — | RAG + regras fiscais — em espera | Usuário vai pesquisar fontes de incidência fiscal e exemplos de RAG que erraram, antes de eu refinar `fiscal_service.py`/RAG. Não iniciar sem os exemplos. | Em espera (usuário) |
| M31.2 | Exportar CSV — Efetividade Comercial | Botão na aba `/torre/efetividade` pra baixar a tabela por cliente (período selecionado) em CSV — pedido do usuário 2026-07-08, registrado pra implementação futura | Média |
| M38 | Robustez do Monitor Contínuo (produção 24/7) | Supervisão de processo (Task Scheduler restart vs. NSSM), reciclagem preventiva de sessão, heartbeat externo, config de energia da máquina — necessário antes de depender do monitor de 5 em 5 min em produção real. Ver FASE 10 acima pro detalhe | **Alta (antes de produção real)** |
| ~~M39~~ | ~~Dashboard Unificado do Ongo (abas na Torre)~~ | ✅ Resolvido em 2026-07-08 — ver FASE 10 acima | — |
| — | Data de Conclusão do lote (Ongo) | Hoje só existe "Data Entrada" (M39). Rastrear quando o lote termina de carregar (1ª vez que `status` vira "Concluída") exigiria uma cache nova tipo `first_seen_cache`, mesma lógica. Habilitaria a análise completa que o usuário pediu ("entrou 13h dia X, concluiu mesmo dia") | Média |
| ~~—~~ | ~~Threading restante (M26)~~ | ✅ Resolvido em 2026-07-07 — `whatsapp_timeline.py`/`rag_service.py` corrigidos; `sheets_service.py` era código morto (não chamado), não precisou de fix | — |
| — | Parser "Embarque Liberado" | Agora com amostra real (M24): `"Liberação de embarque Faz Sol vermelho ID 85748 Ongo- fazer confirmações"` | Média |
| ~~M27.2~~ | ~~Contar Trizy nos KPIs de pendência~~ | ✅ Resolvido no M27 (2026-07-07) — ver FASE 8 | — |
| ~~M28.1~~ | ~~Botão "Sugerir Preço" (RAG)~~ | ✅ Resolvido no M28 (2026-07-07) — ver FASE 8 | — |
| ~~M27.3~~ | ~~Normalizar nome de cliente no filtro~~ | ✅ Resolvido no M27 (2026-07-07) — ver FASE 8 | — |
| ~~—~~ | ~~Aplicar `torre_memoria_global_migration.sql`~~ | ✅ Aplicada em produção 2026-07-07 (2 partes, ver Addendum M27) + backfill do histórico (352/368 fragmentos) | — |
| ~~M28.2a~~ | ~~Trizy — link direto do BID na calculadora~~ | ✅ Resolvido parcialmente em 2026-07-08 (botão pra lista do Trizy) — ver FASE 10, M28.2b (parcial) | — |
| — | Trizy — deep-link pro BID específico | Precisa (1) confirmar padrão real da URL de detalhe no app da Trizy e (2) persistir `negociacaoId` como coluna nova em `octamove_extracao_trizy` (hoje descartado nos dois scrapers) | Média |
| M28.2b | Gmail — rascunho de e-mail via API | **Bloqueado** — precisa escopo `gmail.send` (hoje só `gmail.readonly`); exige o usuário reautorizar OAuth manualmente no navegador | Alta (bloqueado) |
| M28.2c | WhatsApp — payload + disparo Evolution API | Precisa campo novo `remote_jid` em `painel_fretes` (hoje só o grupo é salvo, não a thread exata) | Alta |
| — | Legado ruidoso em `historico_fechamentos` | 286 linhas do Ongo (04/07 e 06/07) ainda com origem/destino em formato de código de fazenda — fix (2026-07-07) só vale pra daqui pra frente; diluem-se naturalmente conforme dado novo (já limpo) se acumula | Baixa |
| ~~M29.1~~ | ~~Reprecificação Semântica (Market Shift)~~ | ✅ Resolvido no M29 (2026-07-07) — ver FASE 8 | — |
| ~~M29.2~~ | ~~Gatilho de Auto-Loss~~ | ✅ Resolvido no M29 (2026-07-07) — ver FASE 8 | — |
| ~~M29.3~~ | ~~Despertador Matinal (WhatsApp Digest)~~ | ✅ Confirmado 2026-07-08 — usuário recebeu a mensagem real no grupo, formato correto (7 cotações, R$570k em risco) | — |
| M32-M37 | Ongo — Valor pra Transportadora | Ver FASE 10 acima (Alerta Sem Localização, Fretes Cancelados+Troca de Nota, Score Compliance, Score CPF motorista, disparo motorista, limpar LANCES_URL morta) — escopo técnico completo já desenhado, não iniciado | Alta→Baixa (ver ordem na FASE 10) |
| M10 | Trizy FASE 2 — POST Lance | **Stand-by (decisão 2026-07-08)** — login usado hoje (`Nova Frota Transportes`) não é cliente pagante nosso; não faz sentido operar lances reais numa conta de terceiro. Retomar quando houver cliente pagante que queira essa função. Botão "Fazer Oferta" na calculadora: `POST /bid/transportadora/cotacao-frete/{negociacaoId}/lance` | Stand-by |
| M10 | Trizy — Token auto-renovação Task Scheduler | Agendar `trizy_login.py` diário para manter sessão ativa | Média |
| M10 | Trizy — Alerta WhatsApp novo BID | Enviar mensagem via Evolution API quando novo BID chega com produto/rota de interesse — velocidade de reação em leilão | Alta |
| M11 | Trizy — CRM N8N | Rebaixado (2026-07-08) — automação nativa via cron (M29.2/M29.3) já cobre o mesmo valor sem depender de ferramenta externa. Reconsiderar só se surgir caso de uso que N8N resolva e a Torre não | Baixa |
| — | Ongo Aba Aderência | Implementar aba "Aderência Transportadoras" (check-in/reagendamento/score por transportadora) no `extract_ongo.py` — ver M15 | Média |
| — | Ongo Task Scheduler na VPS | Hoje roda local no Windows do usuário; migrar pra cron na VPS tornaria o fechamento 23:55 independente do notebook estar ligado | Média |
| — | Adicionar grupos de frete reais | Incluir grupos como "Fretes MT", "APCAM FRETES", "Fretes Rondonópolis" no `GRUPOS_PERMITIDOS` | Média |
| ~~—~~ | ~~Popular `historico_fechamentos`~~ | ✅ RAG ativo com dado real — 408 linhas (288 legado + 120 novas já limpas em 07/07), crescendo diariamente via cron 23:55 | — |
| — | Notificações push | Alerta sonoro/visual quando nova cotação chega na Torre | Baixa |
| ~~—~~ | ~~CRM por embarcador~~ | ✅ Resolvido — virou o Painel de Efetividade Comercial (M31), promovido pra aba própria em 08/07 (M31.1) | — |

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
| Gate `origem/destino != "Não Especificado"` deixa passar cotação fantasma | GPT às vezes devolve `""` (vazio) em vez do sentinela `"Não Especificado"` | Testar `not in ("", "Não Especificado")`, não só `!=` — corrigido no M24 em `webhook_evolution.py` e `gmail_service.py` |
| Status muda no banco mas não aparece na Torre / clique parece "não fazer nada" | Chamada síncrona bloqueante (Supabase/Sheets/Gmail API) rodando dentro de handler ou job `async` trava o event loop inteiro do FastAPI — qualquer requisição concorrente (inclusive o próprio clique) fica parada até a chamada bloqueante terminar | `asyncio.to_thread()` em toda chamada síncrona dentro de função `async` (ver M26); UI do status também virou otimista como segunda camada de defesa |
| `octamove_extracao_trizy` não tem coluna de "última mudança de status" | Tabela só tem `criado_em` (data de ingestão) — nunca foi adicionado um `status_atualizado_em` equivalente ao de `painel_fretes` | M27.5 usa `criado_em` como proxy para "dias parado" no alerta tático — impreciso para BIDs antigos com mudança de status recente; considerar adicionar a coluna se o alerta gerar falso-positivo em produção |
| Hooks de `torre_memoria_global` (M27.1) falhavam silenciosamente | Tabela só existe depois de rodar a migration no Supabase — enquanto não aplicada, `indexar_memoria()`/`indexar_memoria_sync()` logavam erro e retornavam `False`, sem derrubar a ingestão (best-effort por design) | ✅ Resolvido — migration aplicada e M27.1 validado ao vivo em 2026-07-07 (ver M27 acima) |
| `CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops)` truncado no copy-paste do SQL Editor web (`operator class "vector_c" does not exist`) | Mesma classe de armadilha já vista com caracteres decorativos (ver linha de `syntax error at or near "CREATE"` acima) — o editor web do Supabase corrompe/trunca texto colado em certas condições | Rodar a migration em arquivos `.sql` separados e pequenos (um por statement crítico), nunca como um único bloco grande colado junto com texto explicativo; se falhar, isolar a linha problemática num arquivo próprio e rodar sozinha |
| `upsert` sem `delete` acumula lote "fantasma" pra sempre (achado M39.1, 2026-07-08) | Qualquer sync que só faz `upsert(on_conflict=...)` sem remover linhas que saíram da fonte original vai divergir com o tempo — `cargas_ongo` chegou a ter 248 linhas quando só 128 eram reais (120 fantasmas desde 02/07) | Todo sync tipo "espelho de uma lista externa que muda" precisa de um passo de limpeza (`DELETE WHERE id NOT IN (<ids do ciclo atual>)`) depois do upsert — não só `octamove_extracao_trizy`/`cargas_ongo`, checar se o mesmo padrão existe em outras tabelas espelho antes de confiar cegamente |
| Cópia duplicada de script local editada por engano (achado M39.2, 2026-07-08) | `C:\Users\Dell\trizy_extractor.py` (v2, rascunho abandonado) e `no-grain-os/scrapers/trizy/trizy_extractor.py` (v5, real) coexistiam no disco com o mesmo nome de função (`upsert_smart`) — sem Task Scheduler pra desambiguar (Trizy roda manual), editei a v2 por várias mudanças (M27.1 + fix fantasma) sem perceber que não era a usada em produção | Antes de editar qualquer script local em `C:\Users\Dell\*.py`, confirmar que não existe outra cópia com `grep -rn "def <funcao_chave>" /c/Users/Dell --include="*.py"` — checar docstring de versão e data de modificação; arquivo v2 foi marcado `[DEPRECATED]` no cabeçalho, não apagado |
