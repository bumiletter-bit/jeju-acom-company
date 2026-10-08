// #591 엑셀 서류 → 그림(PNG) · PDF — 창구가 만든 양식(사고서류·거래명세서·견적서 등)을 화면에서 바로 보고 그림만 내려받아 보낼 수 있게
//   사용: node scripts/desk/xlsx-image.js <xlsx 경로> [--out <폴더>] [--sheet <이름|번호>] [--no-pdf]
//   방법(10/8 실측으로 정한 길): 이 PC 의 엑셀(Excel COM · Office 16)로 파일을 읽기 전용으로 연 뒤
//     ① 통합문서를 HTML 로 저장(SaveAs 44 · 엑셀이 병합 칸·테두리·글꼴·도장 그림까지 HTML 로 써 줌) → node 가 Playwright(Chromium · JS 끔)로 시트 표를 찍어 PNG
//     ② 시트마다 PDF 저장(ExportAsFixedFormat)
//   🔴 차트에 붙여 Export 하는 길은 창 없이(Visible false)는 빈 PNG(233b) · 창을 띄우면 멈춤 · 시트 Copy() 도 멈춤 — 쓰지 말 것.
//   메모리에서만 손질(원본 xlsx 는 저장하지 않음): 셀 메모 삭제(HTML 이 「[1]」 링크로 바꿔 찍음) · 인쇄 영역이 있으면 그 밖 행·열 숨김(보조 칸이 그림에 안 나오게).
//   출력: <out>/<파일이름>_<시트>.png (+ .pdf) · stdout 마지막 줄 = JSON { ok, files:[{sheet, png, pdf, png_kb, pdf_kb}], error }
//   🔴 엑셀 창은 안 띄움(Visible false · DisplayAlerts false) · 한 번에 한 파일 · 90초 안에 안 끝나면 우리가 띄운 엑셀만 닫고 실패로(대표가 열어 둔 엑셀은 안 건드림).
//   respond.js attachments 에 png·pdf 경로를 넣으면 카드에 그림 미리 보기 + 내려받기 버튼이 붙는다(ATTACH_EXT 에 png·pdf 있음).
const fs = require('fs'), path = require('path'); const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2); const opt = {}; const pos = [];
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--out') opt.out = argv[++i]; else if (argv[i] === '--sheet') opt.sheet = argv[++i]; else if (argv[i] === '--no-pdf') opt.noPdf = true; else pos.push(argv[i]); }
const src = pos[0] ? path.resolve(pos[0]) : '';
const out = (o) => { console.log(JSON.stringify(o)); process.exit(o.ok ? 0 : 1); };
if (!src || !fs.existsSync(src)) out({ ok: false, error: '엑셀 파일 경로를 주세요(없음: ' + src + ')' });
if (!/\.xlsx?$/i.test(src)) out({ ok: false, error: 'xlsx·xls 만 됩니다' });
const outDir = path.resolve(opt.out || path.join(ROOT, '★에이전트오피스', '받은파일'));
fs.mkdirSync(outDir, { recursive: true });
const base = path.basename(src).replace(/\.xlsx?$/i, '');
const stamp = Date.now().toString(36);
const htmBase = path.join(outDir, '_x591_' + stamp);   // HTML 재료(끝나면 지움)
const htm = htmBase + '.htm', htmDir = htmBase + '.files';
// PowerShell(Excel COM) — 메모 삭제 · 인쇄 영역 밖 숨김 → HTML 저장 1회 · 시트별 PDF
const ps = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8   # 한글 경로가 깨지지 않게(node 가 utf8 로 읽음)
$src = '${src.replace(/'/g, "''")}'
$outDir = '${outDir.replace(/'/g, "''")}'
$base = '${base.replace(/'/g, "''")}'
$htm = '${htm.replace(/'/g, "''")}'
$want = '${(opt.sheet || '').replace(/'/g, "''")}'
$noPdf = ${opt.noPdf ? '$true' : '$false'}
$res = @()
$xl = $null
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false
  $wb = $xl.Workbooks.Open($src, 0, $true)   # ReadOnly
  $k = 0
  foreach ($ws in $wb.Worksheets) {
    if ($ws.Visible -ne -1) { continue }   # 숨긴 시트는 HTML 에도 안 나옴
    $k++
    $pick = ($want -eq '' -or $ws.Name -eq $want -or ([string]$ws.Index) -eq $want)
    $ur = $ws.UsedRange
    $empty = ($ur.Cells.Count -le 1 -and -not $ur.Cells.Item(1,1).Value2)
    if (-not $pick -or $empty) { $res += [pscustomobject]@{ sheet = $ws.Name; k = $k; skip = $true }; continue }
    # 셀 메모 삭제(메모리에서만 · HTML 저장 때 「[1]」 각주 링크로 찍히는 것 방지)
    try { while ($ws.Comments.Count -gt 0) { $ws.Comments.Item(1).Delete() } } catch {}
    try { while ($ws.CommentsThreaded.Count -gt 0) { $ws.CommentsThreaded.Item(1).Delete() } } catch {}
    # 인쇄 영역이 있으면 그 밖 행·열 숨김(보조 계산 칸이 그림에 안 나오게)
    try {
      $pa = $ws.PageSetup.PrintArea
      if ($pa) {
        $pr = $ws.Range($pa.Split(',')[0])
        $r1 = $pr.Row; $r2 = $pr.Row + $pr.Rows.Count - 1; $c1 = $pr.Column; $c2 = $pr.Column + $pr.Columns.Count - 1
        $ur2 = $ur.Row + $ur.Rows.Count - 1; $uc2 = $ur.Column + $ur.Columns.Count - 1
        if ($r1 -gt 1) { $ws.Range($ws.Rows.Item(1), $ws.Rows.Item($r1 - 1)).EntireRow.Hidden = $true }
        if ($ur2 -gt $r2) { $ws.Range($ws.Rows.Item($r2 + 1), $ws.Rows.Item($ur2)).EntireRow.Hidden = $true }
        if ($c1 -gt 1) { $ws.Range($ws.Columns.Item(1), $ws.Columns.Item($c1 - 1)).EntireColumn.Hidden = $true }
        if ($uc2 -gt $c2) { $ws.Range($ws.Columns.Item($c2 + 1), $ws.Columns.Item($uc2)).EntireColumn.Hidden = $true }
      }
    } catch {}
    $sheetSafe = ($ws.Name -replace '[\\\\/:*?"<>|]', '_')
    $png = Join-Path $outDir ($base + '_' + $sheetSafe + '.png')
    $pdf = Join-Path $outDir ($base + '_' + $sheetSafe + '.pdf')
    $pdfOk = $false
    if (-not $noPdf) { try { $ws.ExportAsFixedFormat(0, $pdf, 0, $true, $false) | Out-Null; $pdfOk = Test-Path $pdf } catch { $pdfOk = $false } }   # xlTypePDF=0
    $res += [pscustomobject]@{ sheet = $ws.Name; k = $k; skip = $false; png = $png; pdf = $(if ($pdfOk) { $pdf } else { $null }) }
  }
  $wb.SaveAs($htm, 44) | Out-Null   # 44 = xlHtml → <htm> + <htm>.files/sheet00N.htm
  $wb.Close($false) | Out-Null
} finally {
  if ($xl) { try { $xl.Quit() } catch {} ; try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null } catch {} }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
ConvertTo-Json -InputObject @($res) -Compress
`;
const excelPids = () => { try { return String(spawnSync('tasklist', ['/FI', 'IMAGENAME eq EXCEL.EXE', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout).split('\n').map(l => (l.match(/^"EXCEL\.EXE","(\d+)"/) || [])[1]).filter(Boolean); } catch (_) { return []; } };
const before = new Set(excelPids());   // 대표가 열어 둔 엑셀은 건드리지 않게 — 실패 때 우리가 띄운 것만 닫는다
const cleanup = () => { try { fs.unlinkSync(htm); } catch (_) { } try { fs.rmSync(htmDir, { recursive: true, force: true }); } catch (_) { } };
const tmp = path.join(require('os').tmpdir(), 'akm-xlsx-image-' + process.pid + '.ps1');
fs.writeFileSync(tmp, '﻿' + ps, 'utf8');   // BOM 필수(없으면 PowerShell 이 한글을 ANSI 로 읽어 깨짐)
const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8', timeout: 90000, windowsHide: true });
try { fs.unlinkSync(tmp); } catch (_) { }
// 우리가 띄운 엑셀이 Quit 뒤에도 남아 있으면(COM 참조 잔존 · 10/8 실측 1회) 그 프로세스만 닫는다 — 성공·실패 모두
for (const pid of excelPids()) if (!before.has(pid)) { try { spawnSync('taskkill', ['/PID', pid, '/F'], { windowsHide: true, timeout: 5000 }); } catch (_) { } }
if (r.error || r.status !== 0) {
    cleanup();
    out({ ok: false, error: '엑셀 변환 실패: ' + String((r.stderr || r.error && r.error.message || r.stdout || '')).replace(/\s+/g, ' ').slice(0, 300) });
}
let list = []; try { const j = JSON.parse(String(r.stdout).trim().split('\n').pop()); list = Array.isArray(j) ? j : (j ? [j] : []); } catch (e) { cleanup(); out({ ok: false, error: '결과를 읽지 못함: ' + String(r.stdout).slice(-200) }); }
if (!fs.existsSync(htmDir)) { cleanup(); out({ ok: false, error: 'HTML 재료 폴더가 없음: ' + htmDir }); }
(async () => {
    const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
    const files = [];
    const browser = await chromium.launch();
    try {
        // 시트 HTML 은 프레임 밖에서 열리면 스크립트가 다른 페이지로 넘겨 버린다 → JS 끄고 연다
        const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 2, javaScriptEnabled: false });
        for (const x of list) {
            if (!x || x.skip) continue;
            const sheetHtm = path.join(htmDir, 'sheet' + String(x.k).padStart(3, '0') + '.htm');
            if (!fs.existsSync(sheetHtm)) continue;
            const pg = await ctx.newPage();
            await pg.goto('file:///' + sheetHtm.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 20000 });
            await pg.waitForTimeout(400);
            // 본문 첫 표 = 시트(아래 표들은 메모 목록 등) · 여백 없이 표만
            const el = await pg.$('body > table, table');
            if (!el) { await pg.close(); continue; }
            await el.screenshot({ path: x.png, type: 'png' });
            await pg.close();
            files.push({ sheet: x.sheet, png: x.png, pdf: x.pdf || null, png_kb: Math.round(fs.statSync(x.png).size / 1024), pdf_kb: x.pdf && fs.existsSync(x.pdf) ? Math.round(fs.statSync(x.pdf).size / 1024) : null });
        }
    } finally { await browser.close().catch(() => { }); cleanup(); }
    if (!files.length) out({ ok: false, error: '그림으로 만들 시트가 없습니다(빈 통합문서 · 시트 이름 확인)' });
    out({ ok: true, source: src, files, note: 'png·pdf 경로를 respond.js attachments 에 그대로 넣으면 카드에 그림 미리 보기 + 내려받기 버튼' });
})().catch(e => { cleanup(); out({ ok: false, error: 'PNG 찍기 실패: ' + String(e.message || e).slice(0, 200) }); });
