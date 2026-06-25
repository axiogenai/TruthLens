document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('results-root');
    let rawData = sessionStorage.getItem('analysisResult');

    if (!rawData) {
        root.innerHTML = `
            <div class="no-data">
                <div style="font-size:2.5rem;margin-bottom:1rem;">🔍</div>
                <h2>No Analysis Results</h2>
                <p>Submit an article or file first to see the full forensic breakdown.</p>
                <div style="display:flex;gap:0.75rem;flex-wrap:wrap;justify-content:center;">
                    <a href="analyze.html" class="btn-primary">Go to Analyzer</a>
                    <button id="load-mock-btn" class="btn-ghost">Load Demo Data</button>
                </div>
            </div>`;
        document.getElementById('load-mock-btn').addEventListener('click', () => {
            const mockData = {
                "verdict": "Verified", "verdict_score": 93,
                "explanation": "All claims are supported by peer-reviewed evidence. 14 independent outlets corroborate the story. No contradictions detected. Source credibility is excellent.",
                "signals": { "source_credibility": 95, "evidence_strength": 92, "cross_source_agreement": 88, "author_expertise": 96, "contradiction_score": 4, "satire_markers": 0 },
                "sentences": [
                    { "text": "PM Modi and French President Emmanuel Macron launched 'Bharat Innovates 2026' in Nice.", "risk": "Low", "trust_score": 98 },
                    { "text": "The event took place on June 14, 2026, marking a significant step in tech cooperation.", "risk": "Low", "trust_score": 96 },
                    { "text": "This partnership will foster tech startups and collaborative research between the two nations.", "risk": "Low", "trust_score": 99 }
                ],
                "claims": [
                    { "claim": "PM Modi and Macron launched 'Bharat Innovates 2026' in Nice.", "verdict": "True", "explanation": "Confirmed by official MEA statements and 14 independent news outlets." },
                    { "claim": "The initiative aims to boost cooperation in technology and startups.", "verdict": "True", "explanation": "Framework focuses on AI, digital public infrastructure, and startup ecosystems." }
                ],
                "contradictions": [],
                "knowledge_graph": [
                    { "subject": "PM Modi", "predicate": "launched", "object": "Bharat Innovates 2026", "verdict": "Valid", "reason": "Confirmed by MEA press releases." },
                    { "subject": "Emmanuel Macron", "predicate": "participated in", "object": "Bharat Innovates 2026", "verdict": "Valid", "reason": "Verified by Elysée Palace communications." }
                ],
                "ai_generated_probability": 10,
                "spread_risk": "Low", "estimated_reach": "Low <1K",
                "important_words": [],
                "engine_message": "Analysis powered by Axiogen + 6-Stage Verification Pipeline",
                "analyzed_text": "PM Modi and Macron launched 'Bharat Innovates 2026' in Nice."
            };
            sessionStorage.setItem('analysisResult', JSON.stringify(mockData));
            window.location.reload();
        });
        return;
    }

    const original = JSON.parse(rawData);
    const { correctedData, corrections } = verifyAndCorrect(JSON.parse(JSON.stringify(original)));
    sessionStorage.setItem('analysisResult', JSON.stringify(correctedData));
    render(correctedData, corrections);

    // ============================================================
    // DATA VERIFICATION PIPELINE
    // ============================================================
    function verifyAndCorrect(data) {
        const corrections = [];
        if (!data.signals) {
            data.signals = { source_credibility: 50, evidence_strength: 50, cross_source_agreement: 50, author_expertise: 50, contradiction_score: 0, satire_markers: 0 };
            corrections.push("Signals missing — defaults applied");
        } else {
            ['source_credibility','evidence_strength','cross_source_agreement','author_expertise','contradiction_score','satire_markers'].forEach(k => {
                if (data.signals[k] == null) { data.signals[k] = 50; corrections.push(`Signal ${k} missing`); }
                data.signals[k] = Math.max(0, Math.min(100, Math.round(data.signals[k])));
            });
        }
        const sig = data.signals;
        const computed = Math.round(
            sig.source_credibility * 0.25 + sig.evidence_strength * 0.25 +
            sig.cross_source_agreement * 0.20 + sig.author_expertise * 0.15 +
            (100 - sig.contradiction_score) * 0.10 + (100 - sig.satire_markers) * 0.05
        );
        if (data.verdict_score == null) { data.verdict_score = computed; corrections.push("Score computed"); }
        else if (Math.abs(data.verdict_score - computed) > 5) { data.verdict_score = computed; corrections.push(`Score corrected to ${computed}`); }
        data.verdict_score = Math.max(0, Math.min(100, data.verdict_score));

        let expected;
        if (sig.satire_markers >= 70) expected = "Satire / Fiction";
        else if (data.verdict_score >= 80) expected = "Verified";
        else if (data.verdict_score >= 60) expected = "Likely Verified";
        else if (data.verdict_score >= 20) expected = "Unverified";
        else if (data.verdict_score >= 5) expected = "Likely False";
        else expected = "False";
        if (data.verdict !== expected) { corrections.push(`Verdict corrected: ${data.verdict} → ${expected}`); data.verdict = expected; }

        if (data.sentences) {
            data.sentences.forEach((s, i) => {
                if (s.trust_score == null) { s.trust_score = s.risk === 'High' ? 15 : s.risk === 'Medium' ? 50 : 85; }
                if (s.risk === 'Low' && s.trust_score < 70) s.trust_score = 75;
                if (s.risk === 'High' && s.trust_score > 45) s.trust_score = 35;
            });
        }
        if (!data.spread_risk) data.spread_risk = "Low";
        if (!data.estimated_reach) data.estimated_reach = "Low <1K";
        return { correctedData: data, corrections };
    }

    // ============================================================
    // RENDER
    // ============================================================
    function render(data, corrections) {
        const score = data.verdict_score || 0;
        const verdict = data.verdict || "Unverified";
        const prob = data.ai_generated_probability ?? 0;
        const sig = data.signals || {};

        const verdictMap = {
            "Verified":         { cls: "verified",       color: "#10b981", label: "Verified" },
            "Likely Verified":  { cls: "likely-verified", color: "#34d399", label: "Likely Verified" },
            "Unverified":       { cls: "unverified",     color: "#f59e0b", label: "Unverified" },
            "Likely False":     { cls: "likely-false",   color: "#fb923c", label: "Likely False" },
            "False":            { cls: "false",           color: "#ef4444", label: "False" },
            "Satire / Fiction": { cls: "satire",         color: "#8b5cf6", label: "Satire / Fiction" },
        };
        const vc = verdictMap[verdict] || verdictMap["Unverified"];

        const timelineLabels = [], timelineData = [];
        (data.sentences || []).forEach((s, i) => {
            timelineLabels.push(`S${i + 1}`);
            const trust = s.trust_score ?? (s.risk === 'High' ? 15 : s.risk === 'Medium' ? 50 : 85);
            timelineData.push(100 - trust);
        });
        if (timelineLabels.length === 1) { timelineLabels.push('End'); timelineData.push(timelineData[0]); }

        const conScore = sig.contradiction_score || 0;
        const tempScore = 100 - conScore;

        const aiLabel = prob <= 20 ? '<strong>Clearly Human-Written</strong> — Strong natural voice, named sources'
            : prob <= 40 ? '<strong>Likely Human-Written</strong> — Some polished editing detected'
            : prob <= 60 ? '<strong>Ambiguous</strong> — Could be human or AI assisted'
            : prob <= 80 ? '<strong>Likely AI-Generated</strong> — Multiple AI writing patterns detected'
            : '<strong>Almost Certainly AI-Generated</strong> — Highly artificial text patterns';

        const aiColor = prob <= 30 ? '#10b981' : prob <= 60 ? '#f59e0b' : '#ef4444';

        root.innerHTML = `
        <!-- Pipeline Banner -->
        <div class="pipeline-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <div><strong>Forensic Pipeline:</strong> <span>${corrections.length > 0 ? `Resolved ${corrections.length} data inconsistencies. Results corrected.` : 'All data points consistent. Verification complete.'}</span></div>
        </div>

        <!-- Page Header -->
        <div class="page-top">
            <div>
                <h1>Analysis Report</h1>
                <p>6-Stage forensic verification powered by Axiogen</p>
            </div>
            <a href="analyze.html" class="btn-back">← New Analysis</a>
        </div>

        <!-- VERDICT HERO -->
        <div class="verdict-hero" style="--verdict-color: ${vc.color}">
            <div class="verdict-top">
                <div style="flex:1">
                    <div class="verdict-badge ${vc.cls}">
                        <div class="verdict-dot"></div>
                        ${vc.label}
                    </div>
                    <div class="verdict-explanation">${data.explanation || `Verdict score: ${score}/100`}</div>
                </div>
                <div class="score-widget">
                    <div class="score-number" id="score-number">0</div>
                    <div class="score-label">Verification Score</div>
                </div>
            </div>
            <div class="score-bar-outer">
                <div class="score-bar-inner" id="score-bar"></div>
            </div>
            <div class="meta-row">
                <div class="meta-item">
                    <div class="meta-label">Engine</div>
                    <div class="meta-value">Axiogen</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Score</div>
                    <div class="meta-value">${score}/100</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Spread Risk</div>
                    <div class="meta-value ${data.spread_risk === 'High' ? 'risk-high' : data.spread_risk === 'Medium' ? 'risk-med' : 'risk-low'}">${data.spread_risk || 'Low'}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Est. Reach</div>
                    <div class="meta-value">${data.estimated_reach || 'Low <1K'}</div>
                </div>
            </div>
        </div>

        <!-- ROW 1: Signals + AI Prob -->
        <div class="grid-2">
            <!-- Verification Signals -->
            <div class="card">
                <div class="card-title">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    Verification Signals
                </div>
                <div class="signal-list">
                    ${[
                        ['Source Credibility', sig.source_credibility || 0, '#6366f1'],
                        ['Evidence Strength', sig.evidence_strength || 0, '#3b82f6'],
                        ['Cross-Source Agreement', sig.cross_source_agreement || 0, '#06b6d4'],
                        ['Author Expertise', sig.author_expertise || 0, '#8b5cf6'],
                        ['Contradiction Risk', sig.contradiction_score || 0, '#ef4444'],
                        ['Satire Markers', sig.satire_markers || 0, '#f59e0b'],
                    ].map(([name, val, color]) => `
                        <div class="signal-row">
                            <div class="signal-row-top">
                                <span class="signal-name">${name}</span>
                                <span class="signal-val">${val}%</span>
                            </div>
                            <div class="signal-bar-outer">
                                <div class="signal-bar-inner" style="background:${color};width:${val}%"></div>
                            </div>
                        </div>`).join('')}
                </div>
            </div>

            <!-- AI Generation Probability -->
            <div class="card">
                <div class="card-title">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    AI Generation Probability
                </div>
                <div class="ai-big-number" style="color:${aiColor}">${prob}%</div>
                <div class="ai-label">Probability this content was AI-generated</div>
                <div class="ai-bar-outer">
                    <div class="ai-bar-inner ${prob <= 30 ? 'low' : prob <= 60 ? 'medium' : 'high'}" id="ai-bar" style="width:${prob}%"></div>
                </div>
                <div class="ai-verdict-text">${aiLabel}</div>
            </div>
        </div>

        <!-- ROW 2: Suspicion Timeline + Sentence Breakdown -->
        <div class="grid-2">
            <div class="card">
                <div class="card-title">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    Suspicion Timeline
                </div>
                <div class="chart-wrap"><canvas id="lineChart"></canvas></div>
            </div>
            <div class="card">
                <div class="card-title">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    Sentence Breakdown
                </div>
                <div class="sent-list">
                    ${(data.sentences || []).length === 0
                        ? '<div class="empty-state">No sentence data available.</div>'
                        : (data.sentences || []).map(s => `
                            <div class="sent-row ${(s.risk || 'Low').toLowerCase()}">
                                <span class="sent-badge ${(s.risk || 'Low').toLowerCase()}">${s.risk || 'Low'}</span>
                                <span class="sent-text">${s.text}</span>
                            </div>`).join('')}
                </div>
            </div>
        </div>

        <!-- ROW 3: Consistency + Manipulation -->
        <div class="grid-2">
            <div class="card">
                <div class="card-title">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9z"/></svg>
                    Consistency Checks
                </div>
                ${(data.contradictions && data.contradictions.length > 0)
                    ? data.contradictions.map(c => `
                        <div class="consistency-alert warning">
                            <strong>⚡ Conflict Detected</strong>
                            <p>A: "${c.statement_a}"</p>
                            <p>B: "${c.statement_b}"</p>
                            <p style="margin-top:0.3rem;font-style:italic">${c.explanation}</p>
                        </div>`).join('')
                    : `<div class="consistency-alert success">✓ No internal contradictions found. Consistent narrative.</div>`}
                ${conScore > 30 ? `<div class="consistency-alert warning"><strong>⚠ Consistency Warning</strong><p>Contradiction score is elevated (${conScore}%), indicating potential inconsistencies.</p></div>` : `<div class="consistency-alert success">✓ No consistency issues detected.</div>`}
                <div class="dual-score">
                    <div class="dual-score-box">
                        <div class="dual-score-label">Contradiction Risk</div>
                        <div class="dual-score-val ${conScore > 30 ? 'bad' : 'good'}">${conScore}</div>
                    </div>
                    <div class="dual-score-box">
                        <div class="dual-score-label">Temporal Score</div>
                        <div class="dual-score-val ${tempScore > 70 ? 'good' : 'bad'}">${tempScore}</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-title">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2c-4.418 0-8 3.582-8 8s3.582 8 8 8 8-3.582 8-8-3.582-8-8-8z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Manipulation Heatmap
                </div>
                <p style="font-size:0.79rem;color:var(--text-muted);margin-bottom:0.75rem;">High-risk manipulative vocabulary detected:</p>
                <div class="word-cloud">
                    ${(!data.important_words || data.important_words.length === 0)
                        ? '<span class="empty-state">No manipulative keywords flagged.</span>'
                        : data.important_words.map(w => `<span class="word-tag">${w}</span>`).join('')}
                </div>
            </div>
        </div>

        <!-- CLAIMS TABLE -->
        <div class="card" style="margin-bottom:1rem;">
            <div class="card-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                Claim-Level Verification
            </div>
            <p style="font-size:0.79rem;color:var(--text-muted);margin-bottom:0.75rem;">Verifiable claims extracted and cross-referenced with live sources.</p>
            <table class="claims-table">
                <thead><tr><th>Claim</th><th style="width:110px">Status</th><th>Explanation</th></tr></thead>
                <tbody>
                    ${(!data.claims || data.claims.length === 0)
                        ? `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:1rem">No claim extraction data available.</td></tr>`
                        : data.claims.map(c => {
                            const v = (c.verdict || '').toLowerCase();
                            const cls = v === 'true' || v === 'valid' ? 'true' : v === 'false' ? 'false' : 'unverified';
                            return `<tr>
                                <td>${c.claim}</td>
                                <td><span class="badge ${cls}">${c.verdict}</span></td>
                                <td>${c.explanation}</td>
                            </tr>`;
                        }).join('')}
                </tbody>
            </table>
        </div>

        <!-- KNOWLEDGE GRAPH -->
        <div class="card" style="margin-bottom:1rem;">
            <div class="card-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                Knowledge Graph Validation
            </div>
            <p style="font-size:0.79rem;color:var(--text-muted);margin-bottom:0.75rem;">Semantic relationship nodes extracted and checked for factual coherence.</p>
            <div>
                ${(!data.knowledge_graph || data.knowledge_graph.length === 0)
                    ? '<div class="empty-state">No relationship data available.</div>'
                    : data.knowledge_graph.map(k => {
                        const v = (k.verdict || '').toLowerCase();
                        const cls = v === 'valid' ? 'true' : v === 'invalid' ? 'false' : 'unverified';
                        return `<div class="kg-row">
                            <div class="kg-relation" style="flex:1">
                                <span class="subject">${k.subject}</span>
                                <span class="predicate">→ ${k.predicate} →</span>
                                <span class="object">${k.object}</span>
                            </div>
                            <span class="badge ${cls}" style="flex-shrink:0;margin-right:0.75rem">${k.verdict}</span>
                            <div class="kg-reason">${k.reason}</div>
                        </div>`;
                    }).join('')}
            </div>
        </div>

        <!-- FOOTER -->
        <div class="action-footer">
            <a href="analyze.html" class="btn-primary">+ Analyze Another Article</a>
            <a href="index.html" class="btn-ghost">← Back to Home</a>
        </div>`;

        // Animate score counter
        let start = 0;
        const scoreEl = document.getElementById('score-number');
        const scoreBar = document.getElementById('score-bar');
        const step = score / 40;
        const timer = setInterval(() => {
            start = Math.min(start + step, score);
            if (scoreEl) scoreEl.textContent = Math.round(start);
            if (start >= score) clearInterval(timer);
        }, 25);
        setTimeout(() => { if (scoreBar) scoreBar.style.width = score + '%'; }, 100);

        // Charts
        renderCharts(sig, timelineLabels, timelineData);
    }

    function renderCharts(sig, labels, trustData) {
        Chart.defaults.color = '#6b7280';
        Chart.defaults.font.family = 'Inter';

        new Chart(document.getElementById('lineChart').getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Suspicion Level',
                    data: trustData,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99,102,241,0.08)',
                    borderWidth: 2, fill: true, tension: 0.4,
                    pointRadius: 4, pointHoverRadius: 6,
                    pointBackgroundColor: '#6366f1'
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { size: 11 } } },
                    x: { grid: { display: false }, ticks: { font: { size: 11 } } }
                },
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }
            }
        });
    }
});
