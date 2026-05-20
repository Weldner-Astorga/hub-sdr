"""
pdf_compiler.py — Compila múltiplos PDFs ou converte texto/HTML em PDF.
Requer: pip install fpdf2 PyPDF2 requests
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime

try:
    from fpdf import FPDF
    import PyPDF2
except ImportError:
    print("Dependências ausentes. Execute: pip install fpdf2 PyPDF2")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Classe principal de geração de PDF
# ---------------------------------------------------------------------------

class PDFCompiler(FPDF):
    """Subclasse FPDF com cabeçalho e rodapé personalizados."""

    def __init__(self, titulo: str = "Hub SDR — Relatório", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.titulo = titulo
        self.set_auto_page_break(auto=True, margin=15)

    def header(self):
        self.set_font("Helvetica", "B", 14)
        self.cell(0, 10, self.titulo, align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(200, 200, 200)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(150)
        ts = datetime.now().strftime("%d/%m/%Y %H:%M")
        self.cell(0, 10, f"Gerado em {ts} — Página {self.page_no()}", align="C")


# ---------------------------------------------------------------------------
# Funções utilitárias
# ---------------------------------------------------------------------------

def adicionar_secao(pdf: PDFCompiler, titulo: str, corpo: str) -> None:
    """Adiciona uma seção com título em negrito e corpo em texto normal."""
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(30, 80, 160)
    pdf.cell(0, 8, titulo, new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", size=10)
    pdf.set_text_color(50, 50, 50)
    pdf.multi_cell(0, 6, corpo)
    pdf.ln(4)


def adicionar_tabela(pdf: PDFCompiler, cabecalhos: list[str], linhas: list[list]) -> None:
    """Renderiza uma tabela simples."""
    col_w = (pdf.w - 20) / len(cabecalhos)

    # Cabeçalho
    pdf.set_fill_color(30, 80, 160)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 9)
    for h in cabecalhos:
        pdf.cell(col_w, 7, h, border=1, fill=True)
    pdf.ln()

    # Linhas
    pdf.set_text_color(50, 50, 50)
    pdf.set_font("Helvetica", size=9)
    fill = False
    for row in linhas:
        pdf.set_fill_color(240, 245, 255) if fill else pdf.set_fill_color(255, 255, 255)
        for cell in row:
            pdf.cell(col_w, 6, str(cell), border=1, fill=True)
        pdf.ln()
        fill = not fill
    pdf.ln(4)


def mesclar_pdfs(lista_pdfs: list[str], saida: str) -> None:
    """Mescla múltiplos PDFs em um único arquivo de saída."""
    writer = PyPDF2.PdfWriter()
    for caminho in lista_pdfs:
        p = Path(caminho)
        if not p.exists():
            print(f"[AVISO] Arquivo não encontrado: {caminho}")
            continue
        reader = PyPDF2.PdfReader(str(p))
        for page in reader.pages:
            writer.add_page(page)

    with open(saida, "wb") as f:
        writer.write(f)
    print(f"PDF mesclado salvo em: {saida}")


# ---------------------------------------------------------------------------
# Gerador de relatório de leads
# ---------------------------------------------------------------------------

def gerar_relatorio_leads(leads: list[dict], saida: str = "relatorio_leads.pdf") -> str:
    """
    Recebe uma lista de dicts com dados de leads e gera um PDF formatado.

    Campos esperados por lead:
        nome, email, empresa, status, score, origem
    """
    pdf = PDFCompiler(titulo="Hub SDR — Relatório de Leads")
    pdf.add_page()

    adicionar_secao(
        pdf,
        "Resumo",
        f"Total de leads: {len(leads)}\n"
        f"Data de geração: {datetime.now().strftime('%d/%m/%Y %H:%M')}",
    )

    cabecalhos = ["Nome", "Email", "Empresa", "Status", "Score", "Origem"]
    linhas = [
        [
            l.get("nome", "—"),
            l.get("email", "—"),
            l.get("empresa", "—"),
            l.get("status", "—"),
            l.get("score", 0),
            l.get("origem", "—"),
        ]
        for l in leads
    ]
    adicionar_tabela(pdf, cabecalhos, linhas)

    pdf.output(saida)
    print(f"Relatório gerado: {saida}")
    return saida


# ---------------------------------------------------------------------------
# CLI simples
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Hub SDR — PDF Compiler")
    sub = parser.add_subparsers(dest="cmd")

    # Subcomando: gerar relatório de leads a partir de JSON
    p_leads = sub.add_parser("leads", help="Gerar relatório de leads")
    p_leads.add_argument("--json", required=True, help="Caminho para JSON com lista de leads")
    p_leads.add_argument("--saida", default="relatorio_leads.pdf", help="Arquivo PDF de saída")

    # Subcomando: mesclar PDFs
    p_merge = sub.add_parser("mesclar", help="Mesclar múltiplos PDFs")
    p_merge.add_argument("pdfs", nargs="+", help="Arquivos PDF a mesclar")
    p_merge.add_argument("--saida", default="mesclado.pdf", help="Arquivo PDF de saída")

    args = parser.parse_args()

    if args.cmd == "leads":
        with open(args.json, encoding="utf-8") as f:
            leads = json.load(f)
        gerar_relatorio_leads(leads, args.saida)

    elif args.cmd == "mesclar":
        mesclar_pdfs(args.pdfs, args.saida)

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
