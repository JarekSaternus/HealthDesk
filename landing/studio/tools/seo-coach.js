#!/usr/bin/env node
// SEO Auto-Coach CLI — proxy do Studio API endpoints
//
// Użycie:
//   node tools/seo-coach.js scan              # wykrywa kandydatów + generuje propozycje
//   node tools/seo-coach.js list              # lista open tickets
//   node tools/seo-coach.js list all          # wszystkie statusy
//   node tools/seo-coach.js show <ticket-id>  # szczegóły ticketu
//   node tools/seo-coach.js accept <id> [A|B|C]  # accept variant (default = recommended)
//   node tools/seo-coach.js reject <id> [reason]
//   node tools/seo-coach.js snooze <id> [days]
//   node tools/seo-coach.js apply-deploy <id> [variant]  # accept + build + deploy + GSC submit
//
// Wymaga uruchomionego Studio na localhost:4000

const STUDIO = 'http://localhost:4000';

async function api(method, path, body) {
  const res = await fetch(STUDIO + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return { ok: res.ok, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, data: text }; }
}

function fmtTicket(t, full = false) {
  const ageHint = t.metrics_before
    ? `pos ${t.metrics_before.position} | ${t.metrics_before.impressions} imps | ${t.metrics_before.clicks} clicks | CTR ${t.metrics_before.ctr}%`
    : '';
  console.log(`\n[${t.status.toUpperCase().padEnd(8)}] ${t.id} — ${t.lang}/${t.slug}`);
  console.log(`  ${ageHint}`);
  console.log(`  evidence: ${t.evidence}`);
  if (t.applied_variant) console.log(`  applied: ${t.applied_variant} at ${t.applied_at}`);
  if (full) {
    console.log(`  current title: "${t.currentTitle}"`);
    console.log(`  current desc:  "${t.currentDescription}"`);
    console.log('  proposals:');
    for (const p of (t.proposals || [])) {
      const star = p.variant === t.recommended ? ' ★' : '';
      console.log(`    ${p.variant}${star} (${p.strategy}): "${p.title}"`);
      console.log(`       desc: "${p.description}"`);
      console.log(`       why:  ${p.rationale}`);
    }
    if (t.recommended) console.log(`  AI recommends: ${t.recommended}`);
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) {
    console.log('Usage: node tools/seo-coach.js <scan|list|show|accept|reject|snooze|apply-deploy> [args]');
    process.exit(1);
  }

  if (cmd === 'scan') {
    console.log('Scanning GSC for SEO opportunities...');
    const r = await api('POST', '/api/seo-coach/run');
    if (!r.ok) { console.error('Error:', r.data); process.exit(1); }
    console.log(`\nDetected: ${r.data.detected} kandydatów, ${r.data.new_tickets} nowych tickets utworzonych.`);
    for (const t of r.data.tickets || []) fmtTicket(t);
    if (r.data.new_tickets > 0) console.log('\nUżyj `list` żeby zobaczyć szczegóły, `accept <id>` żeby zastosować.');
    return;
  }

  if (cmd === 'list') {
    const filter = args[0] || 'open';
    const r = await api('GET', `/api/seo-coach/tickets?status=${filter}`);
    if (!r.ok) { console.error(r.data); process.exit(1); }
    console.log(`Tickets [${filter}]: ${r.data.count}`);
    if (r.data.last_run) console.log(`Last scan: ${r.data.last_run}`);
    for (const t of r.data.tickets) fmtTicket(t);
    if (r.data.pattern_stats && Object.keys(r.data.pattern_stats).length) {
      console.log('\nLearning stats:');
      for (const [type, s] of Object.entries(r.data.pattern_stats)) {
        console.log(`  ${type}: ${s.successful}/${s.applied} successful, avg CTR gain ${s.avg_ctr_gain || 0}pp`);
      }
    }
    return;
  }

  if (cmd === 'show') {
    const id = args[0];
    if (!id) { console.error('Need ticket ID'); process.exit(1); }
    const r = await api('GET', '/api/seo-coach/tickets?status=all');
    const t = r.data.tickets.find(x => x.id === id);
    if (!t) { console.error('Not found:', id); process.exit(1); }
    fmtTicket(t, true);
    return;
  }

  if (cmd === 'accept') {
    const [id, variant] = args;
    if (!id) { console.error('Usage: accept <id> [A|B|C]'); process.exit(1); }
    const r = await api('POST', `/api/seo-coach/tickets/${id}/accept`, { variant });
    if (!r.ok) { console.error(r.data); process.exit(1); }
    console.log('Applied:', r.data.message);
    fmtTicket(r.data.ticket);
    return;
  }

  if (cmd === 'apply-deploy') {
    const [id, variant] = args;
    if (!id) { console.error('Usage: apply-deploy <id> [A|B|C]'); process.exit(1); }
    const r = await api('POST', `/api/seo-coach/tickets/${id}/accept`, { variant });
    if (!r.ok) { console.error(r.data); process.exit(1); }
    console.log('Frontmatter updated.');
    console.log('Run: cd landing && node build.js && FTP_PASS=... npm run deploy');
    console.log('Then: curl -X POST http://localhost:4000/api/gsc/submit -d \'{"urls":["' + r.data.ticket.url + '"]}\'');
    return;
  }

  if (cmd === 'reject') {
    const [id, ...reasonParts] = args;
    const reason = reasonParts.join(' ') || 'manual';
    const r = await api('POST', `/api/seo-coach/tickets/${id}/reject`, { reason });
    if (!r.ok) { console.error(r.data); process.exit(1); }
    console.log('Rejected:', id, '-', reason);
    return;
  }

  if (cmd === 'snooze') {
    const [id, daysArg] = args;
    const days = parseInt(daysArg) || 14;
    const r = await api('POST', `/api/seo-coach/tickets/${id}/snooze`, { days });
    if (!r.ok) { console.error(r.data); process.exit(1); }
    console.log(`Snoozed until ${r.data.ticket.snooze_until}`);
    return;
  }

  console.error('Unknown command:', cmd);
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
