"""Script de teste — executa extract_ongo.py uma única vez e encerra."""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))

import extract_ongo as m
from playwright.sync_api import sync_playwright

m._validate_env()
m._generate_schema()
print(f"[LOG] schema.sql gerado.")

known_ids, valor_cache, terminal_cache, first_seen_cache, historico_seen = m._load_previous_state()
print(f"[LOG] Estado anterior: {len(known_ids)} IDs em cache | {len(first_seen_cache)} datas de entrada registradas.")

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page()

    print(f"[LOG] Fazendo login...")
    m._login(page)
    print(f"[LOG] Login OK. Executando ciclo único...")

    (mapped, current_ids, new_ids, valor_cache, terminal_cache,
     first_seen_cache, historico_seen) = m.run_cycle(
        1, page, known_ids, valor_cache, terminal_cache,
        first_seen_cache, historico_seen,
    )

    print(f"\n[RESULTADO] {len(mapped)} cargas extraídas | {len(new_ids)} nova(s).")
    if new_ids:
        print(f"[RESULTADO] IDs novos: {', '.join(sorted(new_ids))}")
    print(f"[RESULTADO] Datas de entrada rastreadas: {len(first_seen_cache)} cotações.")
    print(f"[RESULTADO] Abas atualizadas: Carregamentos / Agendamentos / Aderência / Análise por Oferta / Histórico / Análise Mensal / AUDITORIA")

    browser.close()

print("[LOG] Concluído. Ongo_log.json atualizado.")
