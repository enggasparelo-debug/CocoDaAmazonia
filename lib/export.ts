// Helpers de export de dados pra CSV e XLSX (planilha).
// CSV usa BOM UTF-8 pra Excel abrir certo. XLSX é dinâmico via exceljs.

export type ExportRow = Record<string, string | number | null | undefined>;

// Converte uma lista de objetos em CSV separado por ";" (padrão pt-BR
// pra Excel não bagunçar com a vírgula decimal).
export function rowsToCsv(rows: ExportRow[], headers?: string[]): string {
  if (rows.length === 0 && !headers) return "";
  const cols = headers ?? Object.keys(rows[0] ?? {});
  const escape = (v: string | number | null | undefined): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = cols.map(escape).join(";");
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(";"));
  return [head, ...body].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  // BOM UTF-8 pra Excel detectar acentos corretamente
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(blob, filename);
}

export async function downloadXlsx(
  filename: string,
  sheetName: string,
  rows: ExportRow[],
  headers?: string[]
) {
  if (typeof window === "undefined") return;
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  const cols = headers ?? Object.keys(rows[0] ?? {});
  ws.columns = cols.map((c) => ({ header: c, key: c, width: 18 }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow(r);
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
