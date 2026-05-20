# Hub SDR

> Automação de outbound open source para times de vendas — n8n + Supabase + pgvector + IA

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Supabase](https://img.shields.io/badge/Supabase-pgvector-green)](https://supabase.com)
[![n8n](https://img.shields.io/badge/Workflow-n8n-orange)](https://n8n.io)
[![Python](https://img.shields.io/badge/Python-3.10%2B-yellow)](https://python.org)

---

## O que é o Hub SDR

**Hub SDR** é uma plataforma open source de automação de prospecção e qualificação de leads para times de SDR (Sales Development Representatives). Combina:

- **n8n** para orquestração de fluxos de trabalho
- **Supabase** como banco de dados principal com suporte a vetores (`pgvector`)
- **RAG (Retrieval-Augmented Generation)** para enriquecer interações com leads usando a base de conhecimento da empresa
- **Python** para geração automatizada de relatórios em PDF
- **IA** para scoring automático de leads e personalização de mensagens

A maioria das ferramentas de SDR automation custa entre **$300–$1.500/mês** por usuário e são soluções fechadas (Salesloft, Outreach, Apollo). O Hub SDR entrega a **mesma stack** de forma autogerenciável e gratuita, acessível para pequenas e médias empresas, startups e times remotos.

---

## Funcionalidades

| Funcionalidade | Status |
|---|---|
| Webhook para captura de leads | ✅ |
| Validação e normalização de dados | ✅ |
| Persistência no Supabase | ✅ |
| Scoring automático de leads | ✅ |
| Notificação por email (SMTP) | ✅ |
| Alerta via Telegram | ✅ |
| Busca semântica RAG (pgvector) | ✅ |
| Geração de relatórios em PDF | ✅ |
| Mesclagem de PDFs | ✅ |
| Painel de métricas | 🔄 Em desenvolvimento |
| Integração com LinkedIn | 🔄 Planejado |
| Agente IA para follow-up | 🔄 Planejado |

---

## Arquitetura

```
                   ┌─────────────────────────────────────┐
                   │            n8n Workflows             │
                   │                                      │
  Lead entra  ───▶ │  Webhook → Validar → Supabase       │
  (site/api)       │       → Score → Bifurcação          │
                   │         ↙              ↘            │
                   │  Qualificado      Não qualificado    │
                   │  Email + Telegram    Nurturing       │
                   └─────────────────────────────────────┘
                              │
                   ┌──────────▼──────────┐
                   │      Supabase       │
                   │                     │
                   │  leads              │
                   │  interacoes         │
                   │  documentos         │◀── pgvector (RAG)
                   │  campanhas          │
                   └─────────────────────┘
                              │
                   ┌──────────▼──────────┐
                   │  pdf_compiler.py    │
                   │  Relatórios PDF     │
                   │  Exportação de dados│
                   └─────────────────────┘
```

---

## Pré-requisitos

- [n8n](https://n8n.io) (self-hosted ou cloud)
- [Supabase](https://supabase.com) (projeto criado)
- Python 3.10+
- Conta SMTP (Gmail, SendGrid, etc.)
- (Opcional) Bot do Telegram para alertas

---

## Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/Weldner-Astorga/hub-sdr.git
cd hub-sdr
```

### 2. Configure as variáveis de ambiente

```bash
cp .env.example .env
# Edite o .env com suas credenciais
```

### 3. Execute as migrations no Supabase

No painel do Supabase → SQL Editor, cole o conteúdo de `migrations.sql` e execute.

Isso criará:
- Extensão `pgvector`
- Tabelas: `leads`, `interacoes`, `documentos`, `campanhas`, `campanha_leads`
- Função de busca semântica `buscar_documentos()`
- Trigger de `updated_at`

### 4. Importe o fluxo no n8n

1. Acesse seu n8n
2. Vá em **Workflows → Import from file**
3. Selecione `workflows/hub_sdr_n8n_flow.json`
4. Configure as credenciais (Supabase, SMTP, Telegram) nos nós correspondentes
5. Ative o workflow

### 5. Instale dependências Python

```bash
pip install fpdf2 PyPDF2
```

---

## Uso — PDF Compiler

### Gerar relatório de leads

```bash
# Crie um arquivo leads.json com seus dados
python scripts/pdf_compiler.py leads --json leads.json --saida relatorio.pdf
```

Exemplo de `leads.json`:
```json
[
  {
    "nome": "Ana Silva",
    "email": "ana@empresa.com",
    "empresa": "Tech Corp",
    "status": "qualificado",
    "score": 45,
    "origem": "linkedin"
  }
]
```

### Mesclar PDFs

```bash
python scripts/pdf_compiler.py mesclar relatorio1.pdf relatorio2.pdf --saida completo.pdf
```

---

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `SUPABASE_URL` | URL do seu projeto Supabase |
| `SUPABASE_KEY` | Chave anon/service do Supabase |
| `SMTP_HOST` | Servidor SMTP |
| `SMTP_PORT` | Porta SMTP (geralmente 587) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `TELEGRAM_BOT_TOKEN` | Token do bot Telegram |
| `TELEGRAM_SDR_CHAT_ID` | ID do chat/grupo Telegram |
| `N8N_WEBHOOK_URL` | URL base do n8n |

---

## Estrutura do projeto

```
hub-sdr/
├── migrations.sql              # Schema completo do Supabase
├── .env.example                # Variáveis de ambiente (template)
├── README.md                   # Este arquivo
├── LICENSE                     # Licença MIT
├── scripts/
│   └── pdf_compiler.py         # Gerador e mesclador de PDFs
└── workflows/
    └── hub_sdr_n8n_flow.json   # Fluxo n8n principal
```

---

## Impacto e motivação

Mais de **4 milhões de profissionais de SDR** atuam globalmente. No Brasil, o mercado de vendas B2B cresce 18% ao ano, mas **83% das pequenas empresas** não conseguem pagar pelas ferramentas de automação dominantes.

O Hub SDR foi criado para democratizar o acesso à infraestrutura de vendas inteligente:

- **Sem lock-in** — você possui seus dados
- **Autogerenciável** — rode no seu próprio servidor
- **Extensível** — adicione seus próprios nós n8n e modelos de IA
- **Gratuito** — sem licença, sem taxa por usuário

---

## Contribuindo

Contribuições são bem-vindas! Abra uma issue ou PR. Veja o roadmap de funcionalidades na seção de [Issues](https://github.com/Weldner-Astorga/hub-sdr/issues).

---

## Licença

Distribuído sob a licença [MIT](LICENSE). Veja `LICENSE` para mais informações.

---

## Autor

**Weldner Astorga** — [edastorga0@gmail.com](mailto:edastorga0@gmail.com) — [@Weldner-Astorga](https://github.com/Weldner-Astorga)
