# NO GRAIN OS — Product Requirements Document (PRD)

**Versão:** 3.2  
**Data:** 2026-07-06  
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
historico_fechamentos      — embeddings pgvector de fechamentos GANHA/RESPONDIDA + Ongo Geral (RAG)
octamove_extracao_trizy    — BIDs do marketplace Trizy (extrator local no notebook)
cargas_ongo                — lotes do Ongo Cargas (Frete Geral), sincronizados por extract_ongo.py
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

Ongo Cargas (planilha) — LOCAL no notebook Windows
    → Task Scheduler 23:55 (run_ongo_diario.bat) → extract_ongo.py
    → Google Sheets (fonte original) + upsert cargas_ongo (Supabase)
    → Torre lê via /api/ongo-geral (Next.js → Supabase direto) → dashboard "Frete Geral Ongo"
    → fechamento_ongo_diario.py: Volume Liberado x Saldo Restante por rota/produto
      → indexa em historico_fechamentos (mesmo RAG do precificador)

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
- Source cards: Radar WhatsApp / Gmail / **Frete Geral Ongo** / **Trizy BID**
- **Frete Geral Ongo (2026-07-02, M15):** card abre dashboard in-app (antes só linkava pro Google Sheets) — resumo real-time (Total de Lotes / Volume Liberado / Saldo Restante), filtros por Município/Terminal/Empresa recalculando os totais, grid completo + botão para ainda abrir a planilha original
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

### Ingestão Gmail
- Polling automático 1min (inbox + spam), extração via GPT-4o-mini
- **Fix dedup (2026-07-02):** cotações vindas do Gmail paravam de ser gravadas silenciosamente
  (erro `42P10` por `upsert` contra constraint inexistente no banco) e o e-mail era marcado como
  processado mesmo assim — perda permanente. Corrigido: dedup em duas camadas (checa-antes-de-
  inserir na aplicação + índice único parcial `painel_fretes_gmail_message_id_key` no banco,
  aplicado via migration `fix_gmail_dedup.sql`); falha de gravação agora é retentada no próximo
  ciclo em vez de descartada. 8 cotações perdidas recuperadas — ver M17.2/M17.3

### Calculadora de Rotas
- Distância via QualP V4 (cache-aside 24h)
- Pedágios por eixo (7E Bitrem / 9E Rodotrem)
- Piso ANTT automático (Portaria SUROC Nº 04/2026)
- Mapa Leaflet com polyline e marcadores de pedágio
- Painel "Inteligência de Mercado" (RAG top-5 últimos 30 dias)
- Ações: Salvar Preço, Copiar WhatsApp, Enviar Aprovação, Copiar Link
- **Ponto Exato (2026-07-02):** badge `⚡ Usar Ponto Exato` injeta nome do local (Trizy) ou
  coordenada GPS (Ongo/WhatsApp/Gmail) no payload do QualP em vez de só `Cidade/UF`, com
  fallback automático + aviso caso o QualP não geocodifique o ponto. Deployado e validado
  end-to-end na VPS (800+km → 278km na cotação Trizy 00067487). Integração com Google Geocoding
  (pra fechar o gap restante até os ~348km do teto do QualP) foi avaliada, testada e **abortada**
  por restrição de billing no Google Cloud Console do cliente — ver M17/M17.1

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
| `backend/ongo_geral_migration.sql` | ✅ | Tabela `cargas_ongo` (M15) |

---

## 9. MVP Torre de Controle — Plano de Engenharia (2026-07-01)

Ver `MILESTONES.md` FASE 4 para detalhe técnico completo (M12–M16).

| # | Milestone | Status |
|---|-----------|--------|
| M12 | Saneamento Status/SLA/Tipografia Radar — fix raiz do dropdown revertendo (Trizy usava tabela errada no PATCH) | ✅ 2026-07-01 |
| M13 | Pipeline "Aguardando Resposta" (convive c/ roteamento por margem) + export geolocalizado (maps links no template de cópia) | ✅ 2026-07-01 |
| M14 | Hotfix preço Trizy + `@tremor/react` removido (dep morta) + RAG (typo SQL em produção) + saneamento endereço + mapa dark HD | ✅ 2026-07-02 |
| — | **Hotfix crítico QualP** — `/router/v4` (404) → `/rotas/v4` (200) + reescrita completa do parsing (schema real é PT-BR) | ✅ 2026-07-02 |
| M15 | Ongo: dashboard in-app (Total Lotes/Volume Liberado/Saldo Restante) + fechamento diário no RAG | ✅ 2026-07-02 |
| M16 | Gmail anti-ruído + card WhatsApp com volumetria + botão `[Tratado]` | ✅ 2026-07-06 (parcial — card Liberações/parser Embarque Liberado seguem em backlog) |
| M19 | Auditoria de fluxo (cotação Cooperbem) + fix Preço Comercial Final não persistido no Drawer + decisão de Fluxo Híbrido (ver 9.3) | ✅ 2026-07-06 |
| M20 | Geocoding real via Nominatim (fallback quando link do Maps só tem texto de endereço) — ingestão + calculadora | ✅ 2026-07-06 |
| M21 | Logo Trizy no card + filtro de Status dinâmico (fix completude) + Histórico do Ongo com seletor de data dentro da Torre | ✅ 2026-07-06 |
| M22 | Retry de login (3x, browser novo) + alerta WhatsApp real (grupo Teste fretes) quando o cron local do Ongo falhar | ✅ 2026-07-06 |

## 9.1 Backlog Priorizado (legado)

| Prioridade | Item |
|------------|------|
| Alta | Trizy FASE 2: POST lance via calculadora (`/bid/.../lance`) |
| Alta | Trizy: token auto-renovação via Task Scheduler diário |
| Alta | Trizy: alerta WhatsApp para novos BIDs de interesse |
| Média | Trizy CRM N8N: workflow por `status_crm` |
| Média | Ongo: aba Aderência Transportadoras (check-in/reagendamento/score) no extrator |
| Adiada | Ongo: migrar Task Scheduler do notebook Windows para cron na VPS — decisão 2026-07-06: **não migrar agora**, risco de bloqueio anti-bot no IP de datacenter (perderia a ferramenta de extração). Mitigar localmente (retry/alerta) em vez de trocar de ambiente |
| Média | Adicionar grupos reais de frete (APCAM, Fretes MT, etc.) |
| Média | Popular `historico_fechamentos` com dados históricos |
| Baixa | Notificações push / som na Torre ao receber cotação |
| Baixa | CRM por embarcador (taxa de ganho, ticket médio) |
| Baixa | App mobile PWA |
| Média | Perfil few-shot por cliente para calibração da extração no onboarding (ver 9.3) |
| Média | Parser de "Embarque Liberado" (BTG/Ricelly) — card Liberações estruturado (ver M16); falta amostra real de mensagem pra construir |
| Baixa | Investigar mojibake nos textos do WhatsApp (`whatsapp_timeline`) e da aba Histórico do Ongo (campo Rota) — sugere double-encoding na ingestão (Evolution API e/ou `extract_ongo.py` local) |

---

## 9.2 Achados — Varredura Clínica do Portal Ongo (2026-07-04)

Exploração manual (Puppeteer, login como transportadora `Nova Frota Transportes`, mesma conta usada pelo `extract_ongo.py`) de todas as abas do painel `painel.ongocargas.com.br`, com o objetivo de identificar dados nativos do portal que hoje **não são extraídos** e que podem virar inteligência vendável para as transportadoras. Hoje o extrator só cobre `/carregamentos` e `/agendamentos` (ver seção 4).

| Onde (aba do portal) | O que identificamos | Possível implementação | Ganho pro produto | Ganho pro usuário (transportadora) |
|---|---|---|---|---|
| Dashboard de Cargas → widget "Sem Localização" | 11 motoristas marcados "Em Rota" sem nenhum ping de GPS no momento da checagem — hoje é só um número estático na tela, ninguém é avisado | Job de polling lendo esse indicador + alerta automático via WhatsApp (Evolution API) quando motorista fica X horas sem localização | Diferencial "alerta proativo de risco operacional" — nenhum concorrente mostra isso | Reduz risco de carga extraviada/atraso não percebido; evita perda de SLA com o embarcador sem precisar checar o portal manualmente |
| Troca de Nota (aba inteira não coberta) | Métricas nativas de status: 34 Concluído / **26 Cancelado** / 15 Aguardando Transportadora — ~35% de cancelamento de troca de CT-e na semana amostrada | Extrator novo lendo essa aba, upsert em tabela `ongo_troca_nota`, card "% Troca de Nota Cancelada" na Torre | Métrica exclusiva de eficiência fiscal/burocrática, hoje invisível pro cliente | Visibilidade de gargalo de faturamento — menos CT-e parado, cobrança mais rápida |
| Descarregamentos (aba inteira não coberta) | Campo **"Desligou a câmera" (Sim/Não)** + score de completude por descarga (ex.: "4/4", "3/4", "2/4") com foto do canhoto | Capturar os campos e compor um "Score de Compliance" agregado por motorista/transportadora/período | Relatório de compliance vendável separadamente ao embarcador (Alvorada) como "auditoria terceirizada" | Identifica motoristas/rotas de risco antes que virem problema contratual ou multa |
| Autônomos → Motoristas | Cadastro completo com 405 motoristas (Nome, CPF, Proprietário) hoje isolado do restante da análise | Cruzar CPF do motorista com histórico de cancelamento/reagendamento para pontuar risco por indivíduo, não só por transportadora agregada | Aprofunda o "Score de Confiabilidade" (backlog M15) até o nível de motorista | Transportadora sabe exatamente qual motorista está gerando o problema, não só "a frota" de forma vaga |
| Relatórios → Administrativos → Fretes Cancelados (não coberto) | 49 cancelamentos vs. 270 fretes realizados na mesma semana (~18%), já com motorista/origem/destino nominal | Extrator dedicado + card "Taxa de Cancelamento" na Torre, cruzado com Troca de Nota para visão consolidada | Vira o diagnóstico pronto de abertura de reunião comercial — números reais, não estimados | Entende exatamente onde está perdendo frete/dinheiro, rota por rota |
| Relatórios → Administrativos → Aguardando Descarregamento (não coberto) | 83 registros com nome, CPF, **celular** do motorista, placa e "Ticket em análise" (Sim/Não) | Automação de disparo de WhatsApp direto pro motorista parado pedindo status/atualização, sem ligação manual do comercial | Fecha o loop de "substituição de trabalho humano" — de ligação manual para mensagem automática | Reduz tempo de descarga parado, motorista sai mais rápido, gira mais frete/dia |
| Rota `/lances` (constante `LANCES_URL` em `extract_ongo.py`) | Não existe/não acessível para esta conta — redireciona pro Dashboard | Validar se é código morto (remover) ou se depende de outro tipo de conta/permissão antes de continuar confiando nela em produção | Evita manter lógica morta / bug latente no extrator | — (item de higiene técnica) |

**Priorização recomendada (impacto x esforço):** alerta "Sem Localização" e cruzamento Fretes Cancelados + Troca de Nota primeiro (mais baratos, mais fortes pra demo comercial); Score de Compliance de Descarga e granularidade por CPF de motorista em seguida; automação de WhatsApp pro motorista parado depois de validar volume real.

---

## 9.3 Fluxo Híbrido de Cotação (decisão 2026-07-06)

Decisão de produto tomada após auditoria de fluxo (cotação real Cooperbem via e-mail, ver M19 em
`MILESTONES.md`): o fluxo de cotação **não será automatizado de ponta a ponta**. Desenho aprovado:

```
1. Recebe (Email / WhatsApp / Portais)
        ↓
2. Radar — IA classifica: [Cotação] vs [Ruído]
        ↓ (cotação)
   confiança ALTA + cliente calibrado → vira card direto
   confiança BAIXA/MÉDIA ou cliente não calibrado → fila "Revisar" (humano corrige antes de seguir)
        ↓
3. Calculadora (km/pedágio/ANTT) — com fallback de geocoding textual quando o link não tem lat/lng
        ↓
4. Encaminha p/ filial precificar (SLA visível)
        ↓
5. Auditoria unifica + diretoria valida
        ↓
6. Responde no canal de origem — IA redige, humano confirma e clica enviar (nenhum canal dispara sozinho)
        ↓
7. Status → Aguardando Resposta
```

**Princípio:** IA cuida do trabalho mecânico (extração, geocoding, cálculo, sugestão/redação);
humano confirma sempre os dois pontos de risco financeiro/reputacional — preço final e envio da
resposta ao cliente. Fast-track de envio automático para clientes de alta confiança fica para uma
fase futura, não faz parte deste desenho inicial.

**Calibração por cliente (onboarding):** em vez de fine-tuning do modelo (caro, lento, exige
volume de dados que um cliente novo não tem), a calibração é via **perfil few-shot por cliente**:
ao fechar a implementação, reunir alguns e-mails/mensagens reais do cliente, validar a extração
contra eles, e guardar os exemplos corrigidos vinculados ao domínio do remetente (reaproveitando
`services/domain_map.py::resolver_gmail`, já usado para identificar o cliente). Esses exemplos
são injetados no prompt do GPT-4o-mini quando a mensagem vier daquele domínio. Enquanto um cliente
não passar por esse gate, toda cotação dele entra na fila de revisão do passo 2, mesmo com
confiança alta reportada pela IA — confiança alta e errada é o cenário mais perigoso.

**Status:** decisão de arquitetura aprovada; implementação das peças (fila de revisão do Radar,
perfil few-shot por cliente) ainda não iniciada — ver itens correspondentes na tabela de backlog
(9.1).

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
| Novo valor de `status` (ex.: `COTADO_AGUARDANDO`) pode causar 500 | `CHECK constraint` em `painel_fretes.status` (`m6_status_constraint.sql`) só aceita os 8 valores originais | Rodar migration adicionando o valor ao constraint antes de gravar `COTADO_AGUARDANDO` diretamente |
| QualP endpoint/auth errados (RESOLVIDO 2026-07-02) | URL era `/router/v4` (404) — correto é `/rotas/v4`; header era `Authorization: Bearer` (401) — correto é `access-token: TOKEN`. Schema de resposta também é 100% PT-BR (`distancia.valor`, `pedagios[].tarifa.<eixo>`, `polilinha_codificada` — polyline do Google, precisão 1e6, decodificar manualmente; `tabela_frete.dados.A.<eixos>`) | `services/qualp_service.py` reescrito: `_decode_polyline()` + extratores atualizados para o schema real |
| RPC do Supabase diverge do `.sql` local no repo | Alguém editou a função direto no SQL Editor sem atualizar o arquivo versionado (aconteceu com `buscar_fretes_similares`: `data_limite`→`data_limi`) | Sem acesso Postgres direto nem `exec_sql` RPC — reaplicar o `CREATE OR REPLACE FUNCTION` do `.sql` local manualmente no SQL Editor quando suspeitar de divergência |
| Login automatizado no Supabase Studio via Puppeteer | CAPTCHA anti-bot bloqueia (não contornar) | Pedir para o usuário rodar SQL manualmente, ou usar credenciais de API/DB direto quando disponíveis |
| `syntax error at or near "CREATE"` ao rodar migration no SQL Editor | Caracteres decorativos não-ASCII nos comentários (`═`, `──`, acentos) corrompidos no copiar/colar do editor web | Escrever migrations em ASCII puro, sem acentos/box-drawing nos comentários |
| Script Python derruba com `UnicodeEncodeError` (`→`, emojis) ao rodar no Windows | Console/pipe usa `cp1252` por padrão fora de um terminal UTF-8 real — afeta também `.bat` que redireciona output pra log (ex.: cron) | `sys.stdout/stderr.reconfigure(encoding="utf-8", errors="replace")` no topo do script |
