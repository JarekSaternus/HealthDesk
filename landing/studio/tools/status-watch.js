'use strict';
// Pokazuje popup ze statusem ~2 min i ~2 h po uruchomieniu (czyli po starcie kompa, bo
// odpalany z folderu Autostart przez launcher VBS). Po ~2h kończy. Patrz Install-StatusReport.ps1.
// Lekki: dwa timery + spawn status-report.js, brak pętli/obciążenia.

const { execFile } = require('child_process');
const path = require('path');

const NODE = process.execPath;                       // pełna ścieżka do node.exe
const REPORT = path.join(__dirname, 'status-report.js');
const MIN = 60 * 1000;
const H = 60 * MIN;

function report() {
  execFile(NODE, [REPORT, '--popup'], { windowsHide: true }, () => {});
}

setTimeout(report, 2 * MIN);             // ~2 min po starcie (serwer studio ma czas wstać)
setTimeout(report, 2 * H + 2 * MIN);     // ~2 h po starcie
setTimeout(() => process.exit(0), 2 * H + 5 * MIN); // sprzątanie — proces kończy się sam
