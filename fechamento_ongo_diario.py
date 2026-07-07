"""
fechamento_ongo_diario.py — Fechamento diário (23:55) do Ongo Cargas.

Agrupa o estado atual de `cargas_ongo` (Supabase) por rota + produto,
calcula Volume Liberado do Dia x Saldo Restante (o que sobrou) e indexa
cada rota/produto fechado em `historico_fechamentos` (mesma tabela usada
pelo RAG do precificador em no-grain-os/backend/services/rag_service.py),
para que a calculadora possa sugerir preço por similaridade histórica de
rota também com base nos dados do Ongo Geral.

Não cria tabela própria de fechamento — reaproveita historico_fechamentos.
"""

import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from whatsapp_alert import alertar_falha

ENV_FILE = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=ENV_FILE)

SUPABASE_URL         = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
OPENAI_API_KEY       = os.getenv("OPENAI_API_KEY", "")

EMBEDDING_MODEL = "text-embedding-3-small"


def _ts(fmt: str = "%H:%M") -> str:
    return datetime.now().strftime(fmt)


def _montar_texto(origem: str, destino: str, produto: str) -> str:
    return f"Frete de {produto} de {origem} para {destino}".strip()


def _agrupar_por_rota_produto(rows: list) -> dict:
    """Agrupa linhas de cargas_ongo por (origem, destino, produto)."""
    grupos: dict = defaultdict(lambda: {
        "volume_liberado_kg": 0.0,
        "saldo_restante_kg":  0.0,
        "empresas":           defaultdict(int),
        "valor_proposto_ton": None,
    })
    for r in rows:
        origem  = (r.get("origem") or "").strip()
        destino = (r.get("destino") or "").strip()
        produto = (r.get("produto") or "").strip()
        if not origem or not destino or not produto:
            continue
        key = (origem, destino, produto)
        g   = grupos[key]
        g["volume_liberado_kg"] += r.get("quantidade_kg") or 0
        g["saldo_restante_kg"]  += r.get("saldo_restante_kg") or 0
        empresa = r.get("empresa") or ""
        if empresa:
            g["empresas"][empresa] += 1
        if r.get("valor_proposto_ton"):
            g["valor_proposto_ton"] = r["valor_proposto_ton"]
    return grupos


def main() -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print(f"[ERRO {_ts()}] SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes no .env.")
        alertar_falha("Ongo - fechamento diario", "SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes no .env.")
        return
    if not OPENAI_API_KEY:
        print(f"[ERRO {_ts()}] OPENAI_API_KEY ausente no .env.")
        alertar_falha("Ongo - fechamento diario", "OPENAI_API_KEY ausente no .env.")
        return

    from supabase import create_client
    from openai import OpenAI

    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    openai = OpenAI(api_key=OPENAI_API_KEY)

    print(f"[LOG {_ts()}] Lendo estado atual de cargas_ongo...")
    resp = client.table("cargas_ongo").select(
        "origem,destino,produto,empresa,quantidade_kg,saldo_restante_kg,valor_proposto_ton"
    ).execute()
    rows = resp.data or []
    if not rows:
        print(f"[LOG {_ts()}] cargas_ongo vazio — nada para fechar hoje.")
        return

    grupos = _agrupar_por_rota_produto(rows)
    total_liberado = sum(g["volume_liberado_kg"] for g in grupos.values())
    total_saldo    = sum(g["saldo_restante_kg"] for g in grupos.values())
    pct_saldo      = round(total_saldo / total_liberado * 100, 1) if total_liberado else 0

    hoje = datetime.now(timezone.utc).date().isoformat()
    resumo = f"{datetime.now().strftime('%d/%m')} Liberado para histórico"
    print(
        f"[LOG {_ts()}] {resumo} — {len(grupos)} rota(s)/produto(s) | "
        f"Volume Liberado: {total_liberado:,.0f} KG | Saldo Restante: {total_saldo:,.0f} KG "
        f"({pct_saldo}% do liberado)"
    )

    indexados = 0
    for (origem, destino, produto), g in grupos.items():
        valor_tonelada = g["valor_proposto_ton"]
        if not valor_tonelada:
            continue  # sem preço de referência, não alimenta o RAG de precificação

        empresas   = g["empresas"]
        embarcador = max(empresas, key=empresas.get) if empresas else None
        volume_ton = g["volume_liberado_kg"] / 1000
        texto      = _montar_texto(origem, destino, produto)

        try:
            emb_resp  = openai.embeddings.create(model=EMBEDDING_MODEL, input=texto)
            embedding = emb_resp.data[0].embedding
        except Exception as exc:
            print(f"[LOG {_ts()}] ERRO ao gerar embedding para '{texto}': {exc}")
            continue

        try:
            client.table("historico_fechamentos").insert({
                "origem":          origem,
                "destino":         destino,
                "produto":         produto,
                "valor_tonelada":  valor_tonelada,
                "volume_toneladas": volume_ton,
                "embarcador":      embarcador,
                "data_fechamento": hoje,
                "texto_busca":     texto,
                "embedding":       embedding,
            }).execute()
            indexados += 1
        except Exception as exc:
            print(f"[LOG {_ts()}] ERRO ao inserir historico_fechamentos para '{texto}': {exc}")

    print(f"[LOG {_ts()}] Fechamento diário concluído — {indexados} rota(s)/produto(s) indexado(s) no RAG.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        alertar_falha("Ongo - fechamento_ongo_diario.py", str(exc))
        raise
