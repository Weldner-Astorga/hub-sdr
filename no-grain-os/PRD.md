# NO GRAIN OS — Product Requirements Document (PRD)

**Versão:** 3.5  
**Data:** 2026-07-07  
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
liberacoes_eventos         — staging bruto de eventos de liberação/reajuste por fonte (M40, ver 9.7)
liberacoes_ativas          — estado atual consolidado de liberações por cliente/filial/lote (M40, ver 9.7)
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
| `backend/torre_memoria_global_migration_parte1.sql` + `_parte2.sql` | ✅ 2026-07-07 | Tabela `torre_memoria_global` + RPC `buscar_memoria_similar` + índice ivfflat (M27) |
| `backend/liberacoes_migration.sql` | ⏳ criada 2026-07-10, aguardando aplicação do usuário | Tabelas `liberacoes_eventos` + `liberacoes_ativas` (M40, ver 9.7) |

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
| Alta | Contar Trizy nos KPIs de pendência — 44 cotações Trizy hoje invisíveis em "Pendentes"/"Aguardando Resposta" (só contam `painel_fretes`); maior ponto cego achado na auditoria M23 (2026-07-07) |
| Média | Botão "Sugerir Preço" (RAG) na calculadora — já mostra média/histórico similar, falta auto-preencher o campo Preço Proposto |
| Média | Normalizar nome de cliente no filtro dinâmico — duplicatas por capitalização/acentuação (`Agricola Alvorada`/`Agrícola Alvorada`/`AGRÍCOLA ALVORADA`, `Impasa`/`Inpasa`/`Inpsa`) impedem filtrar "tudo de um cliente" num clique |
| Média | Parser "Embarque Liberado" — agora com amostra real de mensagem (M24, 2026-07-07): `"Liberação de embarque Faz Sol vermelho ID 85748 Ongo- fazer confirmações"` |
| Média | Threading restante (mesma classe do M26) — `routers/whatsapp_timeline.py`, `services/rag_service.py`, `services/sheets_service.py` ainda com I/O síncrono em handlers async |
| Em espera | RAG + regras fiscais — usuário vai levantar fontes de incidência fiscal e exemplos de sugestão de preço errada antes de refinar `fiscal_service.py`/RAG (pedido 2026-07-07) |

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

**Milestones formalizados (2026-07-08):** M32-M37 — ver MILESTONES.md FASE 10 pro escopo técnico
completo. Decisões-chave: dashboard via **Looker Studio** conectado nas abas do Sheets (não React
customizado; `extract_ongo.py` já empurra pra 7 abas hoje); alertas/disparos (M32/M36) continuam em
Python já que Looker só exibe; scraping novo roda manual/sob demanda (não automatizado) enquanto não
houver cliente pagante dependendo disso em produção.

**M32 e M34 implementados e validados ao vivo no mesmo dia** (`extract_ongo.py` real): M34 funcionou
de primeira; M32 deu 0 resultados na 1ª tentativa (esperado 10), diagnosticado (endpoint só populua
quando o próprio JS do Dashboard o dispara, não via `fetch()` replicado) e corrigido — reteste ao
vivo confirmou **30 caminhões sem localização** detectados + alerta WhatsApp real disparado. M33
(Fretes Cancelados/Troca de Nota) segue bloqueado — URLs tentadas não bateram. Ver MILESTONES.md
FASE 10 pro detalhe completo.

**M38 — Robustez do Monitor Contínuo (2026-07-08):** produção precisa do monitor de 5 em 5 min
rodando o dia inteiro (não só o cron único das 23:55) — perfil de risco diferente (1 login vivo por
muitas horas, precisa sobreviver e se recuperar sozinho). Fixes de baixo risco já aplicados hoje
(alerta WhatsApp no monitor contínuo, que não existia; pausa de 20s antes do re-login automático,
pra não recriar a fricção de sessões consecutivas observada mais cedo). Camadas maiores — supervisão
de processo (Task Scheduler vs. NSSM), reciclagem preventiva de sessão, heartbeat externo, config de
energia da máquina — desenhadas e documentadas, **não implementadas ainda**, aguardando decisão de
ferramenta numa sessão dedicada. Ver MILESTONES.md FASE 10, M38.

**M39 — Dashboard Unificado do Ongo (2026-07-08) ✅:** pivô de arquitetura — em vez de Looker
Studio/Metabase (ferramenta externa, fricção de UI), o dashboard do M32/M34 virou **mais abas dentro
do `OngoGeralModal` que já existia** (Ao Vivo/Histórico desde o M21). Zero ferramenta nova. De
brinde: aba Ao Vivo ganhou coluna "% Lote" (cálculo já existia só no Histórico) e "Entrada Ongo"
(dado que já existia via `first_seen_cache`, nunca exposto fora do Histórico) — respondendo a
pergunta do usuário sobre rastrear "quando a oferta caiu no Ongo". Testado ao vivo com dado real.

**M39.1 — Bug crítico corrigido no mesmo dia:** usuário achou (comparando Sheets x Torre linha por
linha) que `cargas_ongo` tinha 248 "ofertas" quando só 128 eram reais — `_upsert_cargas_ongo()`
nunca removia lote que saiu da lista ativa do Ongo, acumulando fantasma desde 02/07. Corrigido com
`DELETE` pós-upsert (mesmo full-refresh que o Sheets já fazia); 120 fantasmas limpos na hora direto
no Supabase. De brinde: coluna "Empresa" (sempre o mesmo valor, dashboard é 1 transportadora só)
trocada por "ID Ongo"; alerta vermelho quando saldo restante do lote é menor que o mínimo viável de
carga (7.000kg, ajustável). Validado ao vivo: 128 lotes, volume batendo exato com a soma manual do
usuário (156.294.858 kg). Ver MILESTONES.md FASE 10, M39/M39.1.

**M39.2 — Auditoria de tabelas espelho (2026-07-08) ✅:** mesmo bug do M39.1 também existia em
`octamove_extracao_trizy` (Trizy) — fix diferente (marca `PERDIDA` em vez de apagar, preserva
`status_crm`/`valor_proposto_ton`/`observacao_interna` do usuário). Achado colateral: existiam duas
cópias de `trizy_extractor.py` no disco e o fix (+ o hook M27.1) tinha sido aplicado por engano na
cópia errada (v2, rascunho morto); reaplicado na v5 real em `scrapers/trizy/`. v2 marcada
`[DEPRECATED]`, não apagada. Ver MILESTONES.md FASE 10, M39.2.

**M28.2a + fix cidades (2026-07-08) ✅:** filtro "Município Origem" do Ongo duplicava cidade por
acento/grafia (`"QUERENCIA"` x `"QUERÊNCIA"`) — normalização extraída de `lib/cliente.ts` (M27.3)
para util compartilhado (`lib/normalizacaoTexto.ts`) e reaplicada em `lib/municipio.ts`. Calculadora
ganhou botão "Abrir no Trizy" quando a cotação é um BID Trizy — linka pra lista real de BIDs (única
URL confirmada no código); deep-link pro BID específico fica pendente (precisa `negociacaoId`
persistido no Supabase, hoje descartado nos dois scrapers). Validado ao vivo, deploy feito. Ver
MILESTONES.md FASE 10, M28.2b (parcial).

**M39.3 (2026-07-09) ✅:** migration `ongo_data_entrada_migration.sql` estava registrada como
"aplicada" mas nunca rodou de fato — coluna `data_entrada_ongo` não existia no banco (confirmado com
erro real `42703`), então todo sync `cargas_ongo` desde o M39 vinha falhando silenciosamente (Sheets
seguia fresco, Torre parada em 128 linhas desde uma sincronização manual, enquanto o Sheets já tinha
132). Adicionado `alertar_falha()` no ponto de falha silenciosa; migration entregue ao usuário pra
rodar de verdade — sem precisar de novo login no Ongo, o cron das 23:55 resincroniza sozinho depois.
Ver MILESTONES.md FASE 10, M39.3.

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

## 9.4 Auditoria Comercial GTM + Robustez de I/O (2026-07-07)

**Decisão de produto confirmada pelo usuário:** toda inteligência/analytics futura (backlog 9.2 —
Score de Compliance, Taxa de Cancelamento, alerta "Sem Localização", etc.) deve ser construída pela
ótica da **transportadora**, nunca do embarcador/cliente. Motivo: a estratégia de GTM (ver
[[project_torre_gtm_estrategia]]) é vender para as 38 transportadoras do grupo Ongo, não para a
Agrícola Alvorada. O dashboard "Frete Geral Ongo" (M15) hoje mostra o mundo do embarcador — isso
não será expandido nessa direção; qualquer nova feature de diagnóstico comercial parte do zero já
pensada em transportadora.

**Auditoria de UX/GTM (M23) + correções decorrentes (M24-M26):** ver MILESTONES.md FASE 7 para o
detalhe técnico completo. Resumo executivo:
- Achados de ruído/pontos cegos documentados (backlog 9.1 acima).
- Bug de classificação corrigido (string vazia tratada como cotação fantasma).
- Calculadora passou a reaproveitar cálculo já salvo, sem custo de API repetido.
- Causa raiz de I/O bloqueante identificada e corrigida em 5 pontos do backend (`asyncio.to_thread`)
  — bug que fazia a Torre "travar" ações (ex.: status não atualizar) quando outra rotina síncrona
  rodava ao mesmo tempo.

**Decisão tomada (2026-07-07):** usuário definiu escopo completo da Fase 4 — ver 9.5 (Master PRD
Cérebro Central & Roteamento Omnichannel), que endereça diretamente o item "contar Trizy nos KPIs"
deste achado (M27.2) e "normalizar nome de cliente" (M27.3). RAG e regras fiscais seguem em espera
até o usuário trazer fontes/exemplos concretos.

---

## 9.5 Master PRD — Cérebro Central & Roteamento Omnichannel (2026-07-07)

**Contexto e objetivo de produto:** aproveitando o motor assíncrono validado no M26 (PATCH de status
caindo de bloqueante para 0,64s), o usuário definiu o escopo completo da Fase 4: transformar a Torre
num ecossistema proativo de alta conversão comercial e lock-in de produto. Diretriz explícita:
**sem interface de chat livre para o operador** (evita desperdício de tempo/tokens) — o caminho é
inteligência passiva injetada, automação de cliques e um "Cérebro Central" assíncrono. O "Paper de
Índices de Mercado" (Índice Octamove de Fluidez Logística) fica em **stand-by** no backlog para a
Fase 5 de monetização externa, mas a infraestrutura de dados (torre_memoria_global) já nasce pronta
para suportá-lo.

**⚠️ Renumeração de milestones:** a numeração original do pedido do usuário (M16/M17/M18) **colide**
com milestones já entregues/reservados no projeto — `M16` é "Gmail Anti-Ruído + Triagem WhatsApp"
(✅ parcial), `M17` é "Precisão Geográfica QualP" (✅, com M17.1-M17.3), e `M18.1-M18.6` já estão
reservados no backlog (seção 9.1/9.2) para as features de transportadora do Ongo (alerta Sem
Localização, Troca de Nota, Score de Compliance, etc.). Este Master PRD foi renumerado para
**M27, M28, M29** (a Fase 4 anterior terminou em M26) para não sobrescrever histórico. Ver
MILESTONES.md FASE 8 para o detalhe técnico completo.

### Arquitetura da Memória Global (o Cérebro)
Toda ingestão (WhatsApp, Gmail, Ongo, Trizy) gera um fragmento de memória indexado por proximidade
de cosseno na tabela `public.torre_memoria_global` (`fonte`, `identificador_origem`, `entidade_
cliente`, `texto_resumo`, `embedding VECTOR(1536)`), usando o mesmo pgvector/`text-embedding-3-small`
já validado em `historico_fechamentos` (M8).

### Saneamento arquitetural de I/O (sala de contenção) ✅
Concluído em 2026-07-07 (pós-M29): `routers/whatsapp_timeline.py` (GET /timeline + contagens +
PATCH tratado) e `services/rag_service.py` (busca RPC + insert de indexação) tiveram suas chamadas
Supabase síncronas movidas para `asyncio.to_thread()`, fechando os 2 pontos reais que faltavam do
M26. `services/sheets_service.py` foi auditado e **não é chamado por nenhum handler atual** (código
morto, superado por `sheets_reader.py`/`cargas_ongo`) — não representa risco de bloqueio, não
precisou de fix.

### M27 — Ativação do Cérebro, Visibilidade e Alertas Táticos ✅
**Entregue:** 2026-07-07 — ver MILESTONES.md FASE 8 para o detalhe técnico completo (M27.1-M27.5):
tabela `torre_memoria_global` + hooks nos 4 pontos de ingestão; fim do ponto cego Trizy nos KPIs de
Pendentes; normalização semântica de clientes no filtro; verificação do anti-zeramento do
`COTADO_AGUARDANDO`; Barra de Alerta Tático (`/api/torre/alertas-pendentes`).

### M28 — Roteamento Omnichannel e Inteligência Injetada ⚙️ parcial (2026-07-07)
- **M28.1 — Botão "Sugerir Preço" (RAG Injetado) ✅:** na calculadora, reaproveita o mesmo fetch RAG
  já feito para o painel "Inteligência de Mercado" (zero custo de API extra) — botão preenche o
  campo de preço proposto com a média dos top-5 fechamentos similares.
- **M28.2 — Roteamento condicional de saída por `cotacao.fonte` ❌ não iniciado:** bloqueado —
  Gmail precisa escopo `gmail.send` (reautorização OAuth manual, não automatizável); WhatsApp
  precisa campo novo `remote_jid` em `painel_fretes` (hoje só o grupo é salvo, não a thread exata).
  Trizy (link direto do BID) é trivial mas não feito nesta rodada.

### M29 — Automações Comerciais e Limpeza ⚙️ parcial (2026-07-07)
- **M29.1 — Reprecificação Semântica (Market Shift) ✅:** mesmo fetch RAG do M28.1 — compara média
  das últimas 48h vs. resto da janela de 30 dias; oscilação ≥10% dispara alerta visual na
  calculadora.
- **M29.2 — Gatilho de Auto-Loss ✅:** job diário (06:00 UTC) arquiva como PERDIDA cotações do
  cluster `STATUS_AGUARDANDO` paradas há +5 dias úteis, com motivo anexado em `observacoes`
  (sem migration nova). Testado contra produção (0 candidatos reais no momento do teste).
- **M29.3 — Despertador Matinal (WhatsApp Digest) ⚙️:** job diário (10:45 BRT) consolida contagem +
  valor comercial em risco do cluster `STATUS_AGUARDANDO` e dispara resumo via Evolution API.
  Lógica de consolidação validada com dados reais (7 cotações, R$570k); **envio real do WhatsApp
  ainda não testado** — decisão do usuário, validar no primeiro ciclo pós-deploy na VPS.

### Backlog em stand-by
- **Paper de Índices de Mercado** (Índice Octamove de Fluidez Logística — scraping PRF/concessionárias
  + gargalos de portos secos): retido para a Fase 5 de monetização externa. `torre_memoria_global`
  (M27.1) já nasce como infraestrutura de dados cross-canal para suportá-lo quando retomado.

## 9.6 Fase 9 — Inteligência Competitiva Trizy & Efetividade Comercial ✅ (2026-07-07)

**Contexto:** `octamove_extracao_trizy.status_interno` (estado competitivo do leilão — "Perdendo"/
"Encerrado"/etc.) já era capturado e exibido como texto no Drawer, mas não alimentava SLA/KPI/alerta —
sinal de mercado desperdiçado. Separadamente, a normalização de cliente do M27.3 destravou uma
análise antes imprecisa: efetividade comercial por cliente.

### M30 — Alerta Competitivo Trizy ✅
`/api/trizy/cotacoes` já retornava `status_trizy` a cada ciclo de polling — zero endpoint novo.
Banner laranja quando há BIDs com `status_trizy IN ('Perdendo', 'Encerrado')` e ainda não
finalizados por nós (`status NOT IN ('GANHA', 'PERDIDA')`), reaproveitando o clique-filtra do M27.5
(que ganhou um fix de prioridade no caminho — ver MILESTONES FASE 9).

### M31 — Painel de Efetividade Comercial por Cliente ✅
Agregação client-side sobre WhatsApp+Gmail+Trizy (Ongo Geral fica de fora — mede volume de mercado,
não cotação nossa) usando o cliente já normalizado (M27.3): total, ganhas, perdidas, taxa de
conversão, ticket médio. **Promovido em 2026-07-08 (M31.1)** de modal pra aba própria
(`/torre/efetividade`) com filtro de data real (De/Até), não só presets — feedback do usuário de
que efetividade comercial precisa ser consultável a qualquer momento pelo dono da empresa, não um
popup passageiro. Métrica é por time/funil, não por vendedor individual (Torre não tem
login/autenticação). **Backlog:** exportar CSV da tabela (M31.2, pedido 2026-07-08).

**Entrega 100% frontend** — nenhum endpoint/backend/SQL novo em nenhum dos dois. Deploy feito e
**testado ao vivo no navegador contra a VPS real**: M30 achou 13 BIDs Trizy em risco de verdade
(confirmado `status_trizy: Encerrado` na Auditoria); M31 abriu com 74 cotações/18 clientes reais,
"Impasa" já aparecendo normalizado (confirma sinergia com M27.3). Ver MILESTONES.md FASE 9 para o
detalhe completo do teste.

### Mapa de arquivos afetados
| Camada | Arquivo | Papel no M27 |
|---|---|---|
| SQL | `backend/torre_memoria_global_migration.sql` | Tabela + RPC `buscar_memoria_similar` |
| Backend (serviço) | `backend/services/memoria_global_service.py` | Indexação async (reusa padrão `rag_service.py`) |
| Backend (rota) | `backend/routers/webhook_evolution.py` | Hook de memória em cotação e aviso WhatsApp |
| Backend (serviço) | `backend/services/gmail_service.py` | Hook de memória por e-mail injetado |
| Backend (rota) | `backend/routers/fretes.py` | Não alterado neste M27 (KPI é calculado no frontend) |
| Local (script) | `memoria_global.py` (raiz, novo) | Versão síncrona reusável por Trizy/Ongo |
| Local (script) | `trizy_extractor.py` | Hook em `upsert_smart()` — só BIDs novos |
| Local (script) | `extract_ongo.py` | Hook em `_upsert_cargas_ongo()` — só lotes novos (`new_ids`) |
| Frontend (view) | `frontend-torre/app/page.tsx` | KPI Pendentes (M27.2), filtro Cliente (M27.3), Barra de Alerta (M27.5) |
| Frontend (lib) | `frontend-torre/lib/cliente.ts` (novo) | Normalização semântica de cliente |
| Frontend (rota) | `frontend-torre/app/api/torre/alertas-pendentes/route.ts` (novo) | Endpoint do banner tático |
| Frontend (view) | `frontend-torre/app/torre/calcular/[id]/page.tsx` | M28.1 botão Sugerir Preço + M29.1 alerta Market Shift (mesmo fetch RAG) |
| Backend (serviço) | `backend/services/auto_loss_service.py` (novo) | M29.2 — arquivamento diário de cotações estagnadas |
| Backend (serviço) | `backend/services/digest_service.py` (novo) | M29.3 — consolidação do digest matinal |
| Backend (serviço) | `backend/services/evolution_service.py` (novo) | M29.3 — envio genérico de WhatsApp via Evolution API |
| Backend (app) | `backend/main.py` | Agendamento dos jobs Auto-Loss (06:00 UTC) e Digest Matinal (10:45 UTC) |

---

## 9.7 Master PRD — Módulo Liberações & Aderência (2026-07-10)

**Contexto e origem:** conversa dedicada de BPM/processo a partir da pasta `Rag de Liberações/`
(prints reais de grupo BTG/Agrícola Alvorada, portal SMC BTG Pactual, Cadência Diária da Nova
Frota, Planilha de Clientes Geral) — ver `no-grain-os/MILESTONES.md` FASE 11 para o detalhe técnico
completo de cada milestone. Este módulo ataca a pulverização de "liberação de embarque" (o
fechamento de uma oferta de frete, vindo de WhatsApp/e-mail/portal externo) e a contagem manual de
aderência (caminhões enviados x liberado) feita hoje 2-3x/dia por telefone/planilha.

**Será um módulo dentro da Torre existente** — reaproveita toda a infraestrutura já validada
(ingestão WhatsApp/Gmail, Supabase, RAG duplo `historico_fechamentos`/`torre_memoria_global`, padrão
de FonteCard/drawer/`[Tratado]`), não um app novo.

**Princípios de arquitetura (valem para toda a FASE 11):**
1. Fonte única de verdade no Supabase — qualquer Google Sheets é projeção gerada, nunca editado
   por fora.
2. Humano no loop por exceção — automação aplica direto com confiança alta ou duas fontes
   concordando; diverge ou confiança baixa vira fila de revisão.
3. Portal manda quando conflita com WhatsApp — grupo é gatilho + motivo, portal é o dado
   estruturado.
4. Estado atual (`liberacoes_ativas`) separado de histórico de execução (`execucoes_lote`), mesmo
   princípio da aba Ao Vivo x Histórico do Ongo.
5. Toda liberação/reajuste também é documento comprobatório (contrato entre cliente e empresa) —
   precisa ser guardado, não só extraído e descartado.

**Modelo de dados (5 camadas):**
```
liberacoes_eventos    — staging bruto por fonte (WhatsApp/e-mail/portal), tipo de evento + confiança
liberacoes_ativas     — estado atual consolidado por cliente/filial/lote (M40/M41)
liberacoes_documentos — provas imutáveis (e-mail/print/PDF), nomeação automática, ligadas ao lote (M46)
execucoes_lote        — fato histórico gerado no fechamento do lote (M50)
torre_memoria_global  — síntese narrativa indexada (já existe, M27.1) + historico_fechamentos (já existe, M8)
```

**Decisão de produto (2026-07-14) — margem na aderência, granularidade FINAL por lote:** revisão da
decisão anterior deste mesmo dia, depois de cruzar com os arquivos reais (`Rag de Liberações/`
"Cadência Diária Nova Frota" e "PLANILHA DE CLIENTES GERAL", 51 abas — uma por cliente, incluindo
BTG). As 3 abas conferidas (Agrícola Sul, BTG, Cofco) usam o mesmo cabeçalho: `FILIAL | ONGO | LOCAL
EMBARQUE | DESTINO | STATUS | Produto | FRETE EMP | FRETE MOT. | CADÊNCIA | NO LOCAL | EM TRANSITO |
TOTAL | % AD. | VOLUME | OBSERVAÇÕES` — **FRETE EMP e FRETE MOT. são um par de valores por LOTE**,
não por caminhão; nenhuma das abas reais tem coluna de placa/motorista individual. Usuário confirmou
(2026-07-14): **não precisa de exceção de preço por caminhão** — `preco_motorista_ton` é sempre
**um valor único por lote**, mesmo padrão de `valor_tonelada` (o "FRETE EMP"). `liberacoes_ativas`
ganha `frete_motorista_ton`, `caminhoes_no_local`, `caminhoes_em_transito` (mapeando direto pras
colunas reais "NO LOCAL"/"EM TRANSITO" da planilha); `% AD.` é **calculado** (não armazenado) a
partir de `(no_local + em_transito) / cadencia_diaria` — não persistir coluna derivada.
Visibilidade sem restrição (todo mundo na Torre vê os dois preços). A margem
(`valor_tonelada - frete_motorista_ton`) precisa aparecer explicitamente no card de aderência do
M48 (ex.: "Lote X embarcou 500t a R$10/t de margem = R$5.000"), não só volume/contagem de caminhões.

**Backlog futuro (não agora) — drill-down por caminhão:** usuário propôs (2026-07-14) que clicar no
número agregado (ex.: "1 No Local" do lote 329234) expanda pra mostrar placa/motorista/veículo
daquele caminhão específico — tabela principal continua por lote, o drill-down é uma camada de
detalhe por cima, não muda a granularidade agregada. Depende de M45 (captura de placa/motorista por
evento) e M47 (confirmação de aderência) já existirem com esse dado — registrar como refinamento de
M47/M48, não iniciar agora.

**Milestones (M40-M53 — ver MILESTONES.md FASE 11 para detalhe técnico):**

| # | Milestone | Depende de | Status |
|---|-----------|------------|--------|
| M40 | Schema base (`liberacoes_eventos` + `liberacoes_ativas`) | — | ⚙️ SQL criada, aguardando aplicação |
| M41 | Ongo → `liberacoes_ativas` | M40 | ⚙️ código escrito, bloqueado por M40 |
| M42 | Tela `/torre/liberacoes` + FonteCard | M41 | ✅ concluído (2026-07-10) |
| M43 | Matcher por ID + fila de revisão humana | M40 | ✅ concluído (2026-07-10) |
| M44 | ~~Scraper BTG SMC~~ → **Redefinido:** input manual de aderência na Torre (2026-07-20) | M40, M43 | ✅ Concluído 2026-07-20 — portal SMC em stand-by, decisão do usuário |
| M45 | WhatsApp/e-mail/portal por cliente — classificação rica de eventos, incluindo `ordem_emitida` | M43, M44 | ⚙️ Parcial 2026-07-15 — 5 tipos de evento no ar, `ordem_emitida` bloqueado por falta de amostra real |
| M46 | Persistência de documento comprobatório | M45 | Não iniciado |
| M47 | Contagem híbrida de aderência + trust ladder + margem por lote (`frete_motorista_ton`) | M44 | ⚙️ Schema aplicado 2026-07-14 + produtor manual entregue no M44 (2026-07-20) — falta decidir se ainda precisa de "trust ladder" automático ou se input manual basta por ora |
| M48 | Card de aderência automático (fim do print manual), com margem R$/ton e resultado do lote | M42, M47 | Não iniciado |
| M49 | Envio em tempo real pra filial (Evolution API) | M45 | Não iniciado |
| M50 | Fechamento de lote → histórico + RAG (inclui par preço cliente × preço motorista) | M41, M44, M46 | ✅ Concluído e testado ao vivo 2026-07-20. M46 (documentos) segue não iniciado — síntese roda sem referenciar prova nenhuma por enquanto, campo `documentos_ids` fica vazio |
| M51 | E-mail por cliente | M43 | ✅ Concluído 2026-07-15 |
| M52 | Projeção Google Sheets filtrável | M42 | ✅ Concluído 2026-07-15 |
| M53 | Conciliação Projetado × Real (ordem de carregamento × ticket de balança + nota fiscal) | M45, M46 | **Backlog futuro — não iniciar sem pedido explícito** |

**Decisão de produto (2026-07-14) — extração de `ordem_emitida` (M45):** cada cliente/portal/ERP
emite ordem de carregamento num formato próprio (confirmado pelo usuário — "cada portal tem seu modo
único, cada ERP também"). Em vez de um parser universal, reusa o mesmo padrão já decidido pra
cotação no §9.3 (Fluxo Híbrido — perfil few-shot por cliente calibrado no onboarding): pegar 1 ordem
real de cada cliente/portal, extrair o padrão do que ler/computar, guardar como exemplo few-shot
injetado no prompt de extração daquele cliente. Fontes: grupo WhatsApp dedicado por transportadora
("Ordens Geral Transportadora X", PDF/imagem), e-mail dedicado (`ordens@cliente.com.br`, mesmo
padrão do `gmail_service.py`), e scraper por portal quando aplicável. Reconciliação de duplicata
entre fontes (a mesma ordem pode chegar pelo portal + WhatsApp + e-mail) reaproveita o matcher do
M43 (chave primária = número da ordem quando comparável entre fontes; fallback = placa + motorista +
data). Divergência de quantidade entre fontes pra uma mesma ordem é rara mas possível — cai na fila
de revisão humana já existente do M43, mesma regra "portal manda sobre WhatsApp" já decidida.

**Backlog futuro (M53) — Conciliação Projetado × Real:** a quantidade (toneladas) informada na
ordem de carregamento é **projetada**, não real — o valor real só existe depois do carregamento
(ticket de balança + nota fiscal). Cruzar projetado (ordem) × real (ticket/nota) é de alto valor
(saber exatamente o que foi carregado, não só o que foi ordenado) mas é um módulo à parte, **não
iniciar agora** — decisão explícita do usuário (2026-07-14) de registrar como backlog futuro sem
começar a implementação junto com M44-M52.

**Pesquisa de mercado (2026-07-10):** nenhum concorrente direto (GoComet, Wisor.ai, e2open Rate IQ,
TMS open source como `loadpartner/tms`) resolve a combinação específica de grupo de WhatsApp
informal + portal de cliente + agro brasileiro + mesa comercial pequena — "Torre de Controle" é
categoria de mercado estabelecida no Brasil, mas os adapters de fonte (BTG, Ongo, WhatsApp por
cliente) são inerentemente bespoke. Se o módulo for produtizado para outras tradings/transportadoras
no futuro, o ponto de alavancagem é esses adapters virarem plugáveis, não hardcoded.

---

## 9.8 Handoff Comercial → Filial → Diretoria → Cliente via WhatsApp — M54 ✅ concluído (2026-07-14)

**Gap identificado:** bloco 2.2 do fluxo comercial (não é módulo de Liberações — é dentro do fluxo
de cotação já existente, M6/M7) é hoje 100% manual — comercial liga/manda print pra filial pedir
preço, sem handoff dentro da Torre. Validado que esse padrão (aviso automático WhatsApp no handoff
entre etapas) já é usado por TMS brasileiro (ESL Sistemas, DATAFRETE) — não é especulação.

**Desenho (M54, ver MILESTONES.md FASE 12):** botão/dropdown "Enviar para filial" no `CotacaoDrawer`
dispara WhatsApp (reaproveita `digest_service.py`/Evolution API) com magic link escopado só àquela
cotação — token único, expira em horas, sem tela de login (proporcional ao risco real, não precisa
nível bancário). Cadastro de filial simples (nome + até 2 responsáveis, tabela editada direto no
Supabase). Ordem comercial→filial→diretoria→cliente é configurável por cliente/contrato, não fixa.

## 9.9 Refinamento Efetividade Comercial (2026-07-14) — FASE 13 ✅ completa 2026-07-15

Ver MILESTONES.md FASE 13 (M55-M57) para o detalhe técnico. Três gaps apontados na tela
`/torre/efetividade` (M31/M31.1, já em produção), todos **entregues**: drill-down por cliente (M55,
gaveta lateral com histórico completo do cliente clicado, ignora o filtro de período de propósito),
projeção Sheets pra cotações gerais no mesmo padrão do Ongo Geral (M56, aba "Cotações Gerais" no
mesmo spreadsheet, botão no header da Torre), e redesign do card "Melhor Conversão" → "Precisa de
Atenção" (M57 — 3 opções apresentadas com mockup antes de construir, usuário escolheu a que prioriza
volume alto + conversão baixa em vez de celebrar amostra pequena; reaproveita o drill-down do M55).

---

## 9.10 Achados — Raio-X Engenharia + Mercado (2026-07-17)

Auditoria autônoma (Claude Code, 5 agentes de exploração em paralelo) varrendo backend FastAPI +
frontend Next.js inteiros, com diagnóstico em duas camadas por funcionalidade: engenharia/segurança/UX
e playbook comercial. As 9 funcionalidades mapeadas e o detalhe comercial completo (dor do comprador,
script de pitch, gancho de LinkedIn, avaliação de tripwire) ficaram num artifact publicado nesta
sessão, não replicado aqui — este é o recorte técnico (falhas/redundâncias) que virou trabalho
executável. Três achados (QualP, piso ANTT, Auto-Loss) já ganharam teste de regressão nesta mesma
sessão: `backend/test_qualp_rota.py` (17 checks), `backend/test_antt_piso.py` (27 checks),
`backend/test_auto_loss.py` (29 checks) — todos passando. `backend/check_producao_qualp_antt.py`
confirmou com dado real de produção que QualP está ativo (última rota calculada há 23h no momento da
checagem) e que ANTT só tem coeficiente real cadastrado para Granel Sólido (achado #12 abaixo).

A coluna **% esforço** é uma estimativa de tamanho relativo do item frente ao trabalho total já
entregue no projeto (57 milestones concluídos até aqui) — não é impacto de negócio, é peso de
implementação. Priorização sugerida: M58 primeiro (bloqueador de qualquer venda multi-cliente), depois
M59/M66 (risco de dado errado em produção), resto em qualquer ordem.

| # | Achado | Impacto Negativo | Solução | Impacto Positivo no Projeto | % esforço |
|---|---|---|---|---|---|
| 1 | Zero autenticação em toda a Torre (proxies Next.js + rotas FastAPI) | Qualquer pessoa com acesso à rede lê e edita preço/status/cotação de qualquer registro trocando um ID na URL — nenhuma barreira entre "ver o app" e "editar produção" | Token de sessão mínimo (cookie assinado + `Depends()` no FastAPI) validado primeiro nas rotas de escrita, depois nas de leitura — não precisa de multi-tenant completo agora | Destrava a Torre como produto vendável a terceiros sem risco de um cliente mexer no dado do outro; pré-requisito de qualquer certificação de segurança futura | ~10% |
| 2 | Webhook `/webhook/evolution` sem validar origem + sem dedupe por `msg_id` | POST forjado injeta cotação/frete falso no funil comercial; retry da Evolution reprocessa a mesma mensagem, dobrando custo de IA e podendo duplicar frete | Validar segredo compartilhado no header do webhook + cache/tabela de `msg_id` já processado antes de rodar a pipeline de IA | Fecha o único ponto de entrada de dado externo não autenticado do sistema; corta custo de IA duplicado em retries | ~3% |
| 3 | Memória Global (`torre_memoria_global`) é write-only — RPC `buscar_memoria_similar` existe só no SQL, nenhum código Python a chama | Custo de embedding pago rodando há semanas (todo WhatsApp/Gmail/Trizy/Ongo indexado) sem nenhum retorno de valor — gasto puro, hoje | Implementar 1 endpoint de busca (RPC já pronta) + 1 ponto de consumo real (contexto do RAG de preço, ou sugestão de resposta no handoff) | Ativa a promessa comercial de "memória institucional" já usada no pitch comercial — vira diferencial real, não só custo | ~4% |
| 4 | N+1 no matcher de Liberações — até ~1000 chamadas Supabase sequenciais numa única request `/processar` | Rota trava proporcionalmente ao volume de eventos pendentes; sob volume real vira timeout/lentidão perceptível | Buscar todos os candidatos de uma vez (`.in_()`, padrão já usado em `listar_fila_revisao_sync`) e agrupar updates em lote em vez de loop linha a linha | Torna o matcher seguro pra volume real antes das fontes futuras (BTG/WhatsApp/e-mail) entrarem em produção | ~3% |
| 5 | N+1 no Auto-Loss (`_arquivar_painel_sync`/`_arquivar_trizy_sync`) — update linha a linha em loop | Mesmo padrão de risco do #4, já rodando em produção 1x/dia; hoje inofensivo (poucas linhas), escala mal | Trocar o loop por 1 UPDATE com `.in_("id", [...])`, mesmo filtro que já existe no SELECT | Reduz de N chamadas pra 1 por ciclo diário; `test_auto_loss.py` já protege a correção contra regressão | ~2% |
| 6 | Dashboard com 3 pollers descoordenados (5s/10s/60s) + Sheets relido inteiro a cada 5s sem uso | Sheets lido a cada 5s (com rebuild de credenciais OAuth toda vez) é descartado pela própria tela, que usa Supabase pro mesmo cartão — desperdício de I/O real, não hipotético | Remover a leitura do Sheets do hot path de 5s (usar só Supabase, já é a fonte real da UI); cachear client OAuth do Sheets entre chamadas | Corta a maior fonte de latência/carga desnecessária achada na auditoria, sem mudança visível pro usuário | ~3% |
| 7 | Duas fontes de verdade pro "Frete Geral Ongo" — Supabase pra Ao Vivo, Sheets síncrono (trava o event loop) pra Histórico/Sem Localização | Mesmo conceito lógico servido por dois caminhos diferentes; único bloqueio síncrono real do event loop achado na auditoria inteira | Migrar Histórico/Sem Localização pra ler de `cargas_ongo` (já alimentada pelo `extract_ongo.py`), eliminando a dependência de Sheets síncrono | Fonte única de verdade pro módulo de maior potencial comercial (tripwire "altíssimo" no raio-x — TAM de 38 transportadoras Ongo) | ~4% |
| 8 | Segredos hardcoded no código-fonte (chave Evolution duplicada em 2 arquivos, URL do Supabase de produção como fallback) | Qualquer acesso ao repositório (ou vazamento dele) expõe a chave da Evolution API e a URL do projeto Supabase de produção em texto plano | Mover pra `.env`/`core/config.py`, padrão já usado por todas as outras credenciais do projeto; remover fallback hardcoded do frontend | Fecha o vazamento mais barato de corrigir do lote — puramente mecânico, zero risco de regressão funcional | <1% |
| 9 | Nenhum CI/hook roda os testes de regressão automaticamente | Os 3 testes escritos em 2026-07-17 (73 checks) só protegem se alguém lembrar de rodar `python test_*.py` manualmente — a mesma lacuna que deixou a calculadora 100% fora do ar sem ninguém notar até 01/07 | GitHub Action simples (ou hook de pre-commit) rodando os 3 scripts a cada push/PR | Transforma o teste já escrito de "documentação que dá pra ignorar" em rede de segurança que sempre roda | ~1% |
| 10 | Falhas de rede silenciosas em ações críticas (WhatsApp "Tratado", Liberações Confirmar/Descartar) — UI otimista sem rollback nem toast | Em demo ao vivo ou uso real, uma falha de rede faz a tela "mentir" que a ação funcionou; usuário só descobre quando o dado não bate depois | Padronizar 1 componente de toast (já existe um rascunho `setTimeout` em `page.tsx`, falta generalizar) + reverter otimismo em erro nos pontos que hoje não têm | Elimina o risco mais visível de demo (ação parecer funcionar e não funcionar) em 3 telas distintas | ~2% |
| 11 | `window.prompt()`/`window.alert()` em Liberações — "Corrigir" aceita UUID livre digitado à mão, sem validar pertencimento | UX rudimentar (quebra a ilusão de produto acabado em demo) e risco funcional real: colar o UUID errado aplica o evento no lote errado sem barreira nenhuma | Trocar `window.prompt()` por seletor/autocomplete dos lotes candidatos reais (backend já sabe achá-los via `_buscar_candidatos_sync`); validar pertencimento antes de aplicar | Fecha o ponto de UX mais frágil do raio-x e elimina o único caso onde o operador erra o lote sem nenhuma barreira | ~2% |
| 12 | ANTT — categoria/eixo sem coeficiente cadastrado cai silenciosamente no fallback de Granel Sólido, sem aviso na UI | Confirmado em produção via `check_producao_qualp_antt.py`: só existe coeficiente real cadastrado pra Granel Sólido — qualquer outra categoria de carga está sendo precificada com o piso errado, sem ninguém saber | Emitir aviso visível na calculadora (mesmo padrão do `aviso` que a QualP já retorna) quando `calcular_piso_antt` cai no fallback; ou popular a tabela com coeficientes reais das outras categorias | Remove o risco legal mais concreto do lote — cotar abaixo do piso ANTT sem saber, dor #1 já mapeada no pitch comercial da calculadora | ~2% |

**Milestones formalizados:** M58-M66 — ver MILESTONES.md FASE 14 pro backlog técnico correspondente.

---

## 9.11 Notificação de Liberação pra Filial — E-mail (Resend) como segundo transporte (2026-07-20)

**Status: só análise registrada — nada implementado, nenhuma decisão de fluxo fechada.** Levantado
pelo usuário ao planejar M48 (card de aderência)/M49 (envio via WhatsApp): usar Resend (API de
e-mail transacional) pra automatizar o envio de liberações pra filial — unitário ou em lote — como
segundo canal além do WhatsApp.

**Por que faz sentido:**
- **Destrava o que o M28.2b deixou bloqueado.** O rascunho de e-mail via Gmail API está parado
  porque exige escopo `gmail.send` (hoje só `gmail.readonly`), o que obriga o usuário a reautorizar
  OAuth manualmente no navegador — fricção registrada no backlog (§9.1) sem solução. Resend usa API
  key, sem fluxo OAuth, sem esse bloqueio.
- **Não é canal inventado — é automação de um passo que já existe manual.** `Rag de Liberações/
  Processo Geral de Comercial...txt` já mostra o cliente BTG exigindo e-mail obrigatório por ordem
  pra endereços fiscais (`fiscal@gruposecco.com.br`, `faz.3marias@gruposecco.com.br`), hoje feito à
  mão junto com o WhatsApp.
- **Complementa, não substitui, o WhatsApp** — clientes diferentes já exigem canais diferentes na
  prática (ver mesmo arquivo: alguns exigem grupo cliente×transportadora, outros e-mail direto).

**Desenho recomendado (a validar antes de implementar, não decidido ainda):** um único ponto de
disparo "notificar filial", desacoplado do transporte — o texto que o M48 vai gerar (cliente, rota,
cadência, aderência, margem) alimenta tanto o envio WhatsApp (M49, Evolution API, mesma infra do
M54/`digest_service.py`) quanto o e-mail (Resend), como dois transportes plugáveis atrás da mesma
ação — em vez de três mecanismos paralelos sem nenhum ponto em comum (Handoff M54 + aderência M49 +
e-mail novo).

**Decisões em aberto, registradas como pendência (não escolher agora):**
- Unitário (1 e-mail por liberação) vs. lote (resumo consolidado por filial, mesmo padrão do
  Despertador Matinal M29.3) — provavelmente varia por cliente, não é escolha única pro sistema todo.
- Onde cadastrar o e-mail da filial — estender a tabela `filiais` do M54 (hoje: nome + até 2
  responsáveis + WhatsApp) com um campo de e-mail, ou tabela própria.
- Verificação de domínio de envio no Resend (SPF/DKIM) — depende de qual domínio a empresa for usar.

**Risco a não esquecer quando for desenhar:** esse endpoint de disparo (WhatsApp ou e-mail) seria o
único ponto do sistema que manda dado nosso pra fora. Se o cadastro de destino (e-mail/WhatsApp da
filial) puder ser lido/editado sem autenticação — achado #1 do raio-x, §9.10/M58 — o risco deixa de
ser só vazamento de leitura e vira redirecionar uma liberação real pra endereço errado. Não precisa
esperar o M58 inteiro fechar, mas esse endpoint específico não deveria nascer sem nenhuma trava
mínima — ponto de contato real entre essa ideia e o M58, mesmo que pequeno.

**Decisão do usuário (2026-07-20):** Resend/e-mail fica **adiado pro backlog** — não descartado, só
não entra nessa rodada. M49 segue só com WhatsApp (Evolution API), unitário por lote/evento (não
lote/resumo consolidado — ver justificativa abaixo). Quando o e-mail for retomado, o desenho de
"disparo único, transportes plugáveis" continua valendo; só a implementação do transporte Resend em
si é que fica pra depois. As 3 perguntas em aberto sobre e-mail (unitário/lote pra esse canal, campo
na tabela `filiais` vs. caixa de setor tipo `fiscal@`, domínio pra verificar no Resend) continuam
sem resposta — refazer essa análise quando o usuário voltar ao tema.

**Para retomar:** M48/M49 em execução (WhatsApp apenas). Ver MILESTONES.md FASE 11 (M48/M49) pra
status de implementação.

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
| Mesmo erro persiste mesmo com migration 100% ASCII, tipicamente logo após um `CREATE INDEX` | Corrupção intermitente do paste multi-statement no editor web (Monaco) — não é sobre encoding, é sobre volume de comandos colados de uma vez | Colar e rodar **um `CREATE`/`ALTER` por vez** em vez do arquivo inteiro de uma vez (confirmado em M40, 2026-07-10) |
| Script Python derruba com `UnicodeEncodeError` (`→`, emojis) ao rodar no Windows | Console/pipe usa `cp1252` por padrão fora de um terminal UTF-8 real — afeta também `.bat` que redireciona output pra log (ex.: cron) | `sys.stdout/stderr.reconfigure(encoding="utf-8", errors="replace")` no topo do script |
| Ação na Torre "não funciona" (ex.: status não muda na tela) mas o dado está certo no banco | Chamada síncrona bloqueante (Supabase/Sheets/Gmail API) dentro de handler/job `async` trava o event loop inteiro — qualquer requisição concorrente fica parada até terminar | `asyncio.to_thread()` em toda chamada síncrona dentro de função `async` (corrigido em 5 pontos no M26 — `fretes.py`, `cotacoes.py`, `webhook_evolution.py`, `gmail_service.py`, `antt_crawler.py`; restam `whatsapp_timeline.py`/`rag_service.py`/`sheets_service.py`) |
| Mensagem sem rota real vira "cotação" fantasma (campos em branco) | GPT às vezes devolve `""` em vez do sentinela `"Não Especificado"` para origem/destino — gate que só testava `!=` deixava passar | Testar `not in ("", "Não Especificado")` (corrigido no M24) |
| Backend engorda de ~90MB para 1GB+ em horas, `/fretes` fica lento (8-15s+) até travar (2026-07-15) | Todo router/service chamava `create_client()` do zero a cada requisição (`fretes.py`, `cotacoes.py`, `handoff.py`, `whatsapp_timeline.py`, `liberacoes_matcher_service.py`, `supabase_reader.py`, `supabase_writer.py`, `timeline_writer.py`) — sob tráfego real (webhook WhatsApp contínuo, poll Gmail 60s, polling da Torre 5-10s) as conexões nunca fechadas se acumulavam em ~16h de uptime até saturar a VPS de 2 vCPUs | `services/supabase_client.py` virou singleton (cliente único criado no primeiro uso, reaproveitado por todo o app); todo `create_client()` avulso removido dos routers/services, todos importam `get_supabase_client` de lá. `core/database.py` (tentativa antiga de singleton assíncrono, nunca usada por ninguém) removida por confundir com o padrão certo. Mitigação complementar: `pm2 start ... --max-memory-restart 500M` em `deploy_vps.py` — reinicia sozinho se algo escapar do controle, mesmo com o vazamento corrigido na raiz. |
| WhatsApp: `SessionError: No sessions` em TODO envio (DM e grupo), reconectar/QR novo/restart não resolvia (2026-07-16) | Instância do Evolution (`octamove`) estava conectada ao número **pessoal** do usuário, com anos de histórico em dezenas de grupos — Baileys precisa sincronizar a conta inteira (não só o grupo que `GRUPOS_PERMITIDOS` filtra no código), gerando 200%+ CPU / 2,5GB+ RAM no container e travando até chamadas básicas de status | Migrar a instância pra um número **dedicado**, sem histórico (`556692207154`, instância renomeada `KM`) — CPU caiu pra 2,7%, RAM pra ~100MB, envio voltou a funcionar. `INSTANCIA` em `services/evolution_service.py`/`routers/webhook_evolution.py` atualizado; webhook reconfigurado via `POST /webhook/set/{instancia}` (payload é **flat**: `{"url":...,"webhook_by_events":...,"events":[...]}`, não aninhado sob `"webhook":{...}`). Reconectar/trocar QR na MESMA conta pessoal não resolve — o problema é a conta em si, não a sessão. |
| Magic link do M54 chega no WhatsApp mas não fica clicável | URL é `http://<IP>:3000/...` — IP puro, sem domínio, sem HTTPS; WhatsApp não linkifica URLs de IP literal (proteção própria dele) | Precisa de domínio + HTTPS (Let's Encrypt) apontando pra VPS — backlog, não urgente (usuário vai providenciar domínio). Até lá, destinatário copia o link segurando o dedo em cima do texto. |
