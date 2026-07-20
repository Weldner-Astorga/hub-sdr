"""
memoria_global.py — M27.1 Cerebro Central (versao sincrona para scripts locais).

Reaproveitado por trizy_extractor.py e extract_ongo.py para gravar um fragmento
de memoria (resumo + embedding) em public.torre_memoria_global a cada registro
novo ingerido, na mesma tabela unificada usada pelo backend (services/
memoria_global_service.py). Mesmo padrao ja usado em fechamento_ongo_diario.py:
best-effort, nunca derruba o script chamador se OpenAI/Supabase falharem.
"""
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

SUPABASE_URL         = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
OPENAI_API_KEY       = os.getenv("OPENAI_API_KEY", "")

EMBEDDING_MODEL = "text-embedding-3-small"

_supabase_client = None
_openai_client = None


def _clients():
    global _supabase_client, _openai_client
    if _supabase_client is None and SUPABASE_URL and SUPABASE_SERVICE_KEY:
        from supabase import create_client
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    if _openai_client is None and OPENAI_API_KEY:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    return _supabase_client, _openai_client


def indexar_memoria_sync(
    fonte: str,
    identificador_origem: str,
    texto_resumo: str,
    entidade_cliente: str = "",
) -> bool:
    """Gera embedding do resumo e grava (upsert) em torre_memoria_global. Best-effort."""
    if not identificador_origem or not (texto_resumo or "").strip():
        return False

    sb, openai = _clients()
    if sb is None or openai is None:
        return False

    try:
        emb_resp = openai.embeddings.create(model=EMBEDDING_MODEL, input=texto_resumo)
        embedding = emb_resp.data[0].embedding
    except Exception as exc:
        print(f"[MemoriaGlobal] Erro ao gerar embedding ({fonte}/{identificador_origem}): {exc}")
        return False

    try:
        sb.table("torre_memoria_global").upsert(
            {
                "fonte":                fonte,
                "identificador_origem": identificador_origem,
                "entidade_cliente":     entidade_cliente or None,
                "texto_resumo":         texto_resumo,
                "embedding":            embedding,
            },
            on_conflict="fonte,identificador_origem",
        ).execute()
        return True
    except Exception as exc:
        print(f"[MemoriaGlobal] Erro ao gravar ({fonte}/{identificador_origem}): {exc}")
        return False


def _pct_aderencia_lote(lote: dict) -> float | None:
    m = re.search(r"\d+", lote.get("cadencia_diaria") or "")
    if not m:
        return None
    cad = int(m.group())
    if cad == 0:
        return None
    no_local = lote.get("caminhoes_no_local") or 0
    em_transito = lote.get("caminhoes_em_transito") or 0
    return (no_local + em_transito) / cad * 100


def _montar_sintese_execucao(lote: dict, margem_ton, pct_ad, volume_t: float, saldo_t: float) -> str:
    partes = [
        f"Liberação encerrada ({lote.get('status')}): {lote.get('cliente') or 'Cliente não identificado'}",
        f"Rota: {lote.get('origem') or '—'} -> {lote.get('destino') or '—'}",
        f"Produto: {lote.get('produto') or '—'}",
        f"Volume total: {volume_t:.0f}t (saldo final: {saldo_t:.0f}t)",
    ]
    if lote.get("valor_tonelada") is not None:
        partes.append(f"Preço cliente: R$ {float(lote['valor_tonelada']):.2f}/t")
    if lote.get("frete_motorista_ton") is not None:
        partes.append(f"Frete motorista: R$ {float(lote['frete_motorista_ton']):.2f}/t")
    if margem_ton is not None:
        partes.append(f"Margem: R$ {margem_ton:.2f}/t")
    if pct_ad is not None:
        partes.append(f"Aderência final: {int(pct_ad + 0.5)}%")
    return " | ".join(partes)


def registrar_execucao_lote_sync(lote: dict) -> bool:
    """M50 — ao lote de liberação fechar (zerado/cancelado), gera o fato
    histórico em execucoes_lote e alimenta os 2 RAGs já existentes
    (historico_fechamentos, mesma tabela do precificador; torre_memoria_global,
    fonte="execucao_lote"). Best-effort: nunca derruba o ciclo do Ongo se
    OpenAI/Supabase falharem — mesma politica de indexar_memoria_sync.

    Documentos comprobatórios (M46) ainda não existem no projeto —
    documentos_ids fica vazio até esse milestone entrar; a sintese segue sem
    referenciar prova nenhuma por enquanto.
    """
    sb, openai = _clients()
    if sb is None:
        return False

    valor_tonelada = lote.get("valor_tonelada")
    frete_motorista_ton = lote.get("frete_motorista_ton")
    margem_ton = (
        float(valor_tonelada) - float(frete_motorista_ton)
        if valor_tonelada is not None and frete_motorista_ton is not None
        else None
    )
    pct_ad = _pct_aderencia_lote(lote)
    volume_t = (lote.get("volume_total_kg") or 0) / 1000
    saldo_t = (lote.get("saldo_kg") or 0) / 1000
    volume_embarcado_t = max(volume_t - saldo_t, 0)

    try:
        sb.table("execucoes_lote").upsert(
            {
                "fonte":                lote["fonte"],
                "id_externo":           lote["id_externo"],
                "cliente":              lote.get("cliente"),
                "origem":               lote.get("origem"),
                "destino":              lote.get("destino"),
                "produto":              lote.get("produto"),
                "volume_total_kg":      lote.get("volume_total_kg"),
                "saldo_final_kg":       lote.get("saldo_kg"),
                "valor_tonelada":       valor_tonelada,
                "frete_motorista_ton":  frete_motorista_ton,
                "margem_ton":           margem_ton,
                "status_final":         lote.get("status"),
            },
            on_conflict="fonte,id_externo",
        ).execute()
    except Exception as exc:
        print(f"[ExecucaoLote] Erro ao gravar execucoes_lote ({lote.get('fonte')}/{lote.get('id_externo')}): {exc}")
        return False

    texto = _montar_sintese_execucao(lote, margem_ton, pct_ad, volume_t, saldo_t)

    if openai is not None:
        try:
            emb_resp = openai.embeddings.create(model=EMBEDDING_MODEL, input=texto)
            embedding = emb_resp.data[0].embedding
            valor_total = float(valor_tonelada) * volume_embarcado_t if valor_tonelada is not None else None
            sb.table("historico_fechamentos").insert(
                {
                    "origem":           lote.get("origem"),
                    "destino":          lote.get("destino"),
                    "produto":          lote.get("produto"),
                    "tipo_veiculo":     None,
                    "valor_tonelada":   valor_tonelada,
                    "valor_total":      valor_total,
                    "volume_toneladas": volume_embarcado_t,
                    "embarcador":       lote.get("cliente"),
                    "data_fechamento":  datetime.now(timezone.utc).date().isoformat(),
                    "texto_busca":      texto,
                    "embedding":        embedding,
                }
            ).execute()
        except Exception as exc:
            print(f"[ExecucaoLote] Erro ao indexar historico_fechamentos ({lote.get('fonte')}/{lote.get('id_externo')}): {exc}")

    indexar_memoria_sync(
        fonte="execucao_lote",
        identificador_origem=f"{lote['fonte']}#{lote['id_externo']}",
        texto_resumo=texto,
        entidade_cliente=lote.get("cliente") or "",
    )

    return True
