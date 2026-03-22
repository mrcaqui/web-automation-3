import ExcelJS from 'exceljs';

interface ShiftEntry {
  date: string;
  upper: string;
  lower: string;
}

interface ParseResult {
  memberRow: number;
  entries: ShiftEntry[];
}

export async function runShiftExcel(
  sheet: string,
  member: string,
  opts: { file?: string },
) {
  const filePath = opts.file ?? '.claude/skills/shift/shift.xlsx';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet(sheet);
  if (!ws) {
    console.log(
      JSON.stringify({
        error: 'Sheet not found',
        sheets: wb.worksheets.map((s) => s.name),
      }),
    );
    process.exitCode = 1;
    return;
  }

  // Row 6: date row (col 4 = day 1, col 5 = day 2, ...)
  const dateMap: Record<number, number> = {};
  ws.getRow(6).eachCell({ includeEmpty: false }, (cell, col) => {
    if (
      col >= 4 &&
      typeof cell.value === 'number' &&
      cell.value >= 1 &&
      cell.value <= 31
    ) {
      dateMap[col] = cell.value;
    }
  });

  // Find member row (upper row of the 2-row set)
  let memberRow = -1;
  for (let r = 7; r <= Math.min(ws.rowCount, 60); r++) {
    const v = ws.getRow(r).getCell(3).value;
    if (v && String(v).trim().toLowerCase() === member.toLowerCase()) {
      memberRow = r;
      break;
    }
  }

  if (memberRow === -1) {
    console.log(JSON.stringify({ error: 'Member not found' }));
    process.exitCode = 1;
    return;
  }

  const year = sheet.substring(0, 4);
  const month = sheet.substring(4, 6);
  const upperRow = ws.getRow(memberRow);
  const lowerRow = ws.getRow(memberRow + 1);

  const entries: ShiftEntry[] = [];

  for (const [colStr, day] of Object.entries(dateMap)) {
    const col = Number(colStr);
    const upperVal = upperRow.getCell(col).value;
    const lowerVal = lowerRow.getCell(col).value;
    const upper = upperVal && typeof upperVal === 'string' ? upperVal.trim() : '';
    const lower = lowerVal && typeof lowerVal === 'string' ? lowerVal.trim() : '';

    if (upper || lower) {
      const dd = String(day).padStart(2, '0');
      entries.push({ date: `${year}-${month}-${dd}`, upper, lower });
    }
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));

  const result: ParseResult = { memberRow, entries };
  console.log(JSON.stringify(result));
}
