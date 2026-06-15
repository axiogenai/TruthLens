document.addEventListener('DOMContentLoaded', () => {
    let rawData = sessionStorage.getItem('analysisResult');
    if (!rawData) {
        document.getElementById('results-card').innerHTML = `
            <div class="card" style="text-align:center; padding:3rem;">
                <div style="font-size:3rem; margin-bottom:1rem;">🔍</div>
                <h2 style="margin-bottom:1rem;">No Results Yet</h2>
                <p style="color:var(--text-muted); margin-bottom:1.5rem;">Run an analysis first or load mock demo data to inspect the dashboard.</p>
                <div style="display:flex; gap:1rem; justify-content:center; flex-wrap:wrap;">
                    <a href="analyze.html" class="btn primary-btn" style="text-decoration:none;">Go to Analyzer →</a>
                    <button id="load-mock-btn" class="btn secondary-btn" style="border-color:var(--accent-primary); color:var(--accent-primary);">Load Mock Demo Data</button>
                </div>
            </div>`;

        document.getElementById('load-mock-btn').addEventListener('click', () => {
            const mockData = {
                "verdict": "Verified",
                "verdict_score": 93,
                "explanation": "All claims supported by peer-reviewed evidence. 14 independent outlets corroborate. No contradictions detected. Source credibility is excellent.",
                "signals": {
                    "source_credibility": 95,
                    "evidence_strength": 92,
                    "cross_source_agreement": 88,
                    "author_expertise": 96,
                    "contradiction_score": 4,
                    "satire_markers": 0
                },
                "sentences": [
                    { "text": "PM Modi and French President Emmanuel Macron launched the 'Bharat Innovates 2026' initiative in Nice.", "risk": "Low", "trust_score": 98 },
                    { "text": "The event took place on June 14, 2026, marking a significant step in tech cooperation.", "risk": "Low", "trust_score": 96 },
                    { "text": "This partnership will foster tech startups and collaborative research between the two nations.", "risk": "Low", "trust_score": 99 }
                ],
                "claims": [
                    { "claim": "PM Modi and French President Emmanuel Macron launched 'Bharat Innovates 2026' in Nice.", "verdict": "True", "explanation": "Official statements from the MEA and news coverage verify the joint launch in Nice on June 14, 2026." },
                    { "claim": "The initiative aims to boost cooperation in technology and startups.", "verdict": "True", "explanation": "The framework focuses on expanding synergies in digital public infrastructure, AI, and startup ecosystems." }
                ],
                "contradictions": [],
                "citations": [
                    { "claim": "Joint launch of Bharat Innovates 2026", "source": "Ministry of External Affairs, India", "status": "Supports", "analysis": "Matches the official joint press statement." }
                ],
                "knowledge_graph": [
                    { "subject": "PM Modi", "predicate": "launched", "object": "Bharat Innovates 2026", "verdict": "Valid", "reason": "Confirmed by MEA press releases." },
                    { "subject": "Emmanuel Macron", "predicate": "participated in", "object": "Bharat Innovates 2026", "verdict": "Valid", "reason": "Verified by official Elysée Palace communications." }
                ],
                "ai_generated_probability": 10,
                "spread_risk": "Low",
                "estimated_reach": "Low <1K",
                "counterfactual_advice": "This content appears factually sound. No immediate action needed.",
                "important_words": [],
                "engine_message": "Analysis powered by Gemini 2.5 Flash + 6-Stage Verification Pipeline.",
                "analyzed_text": "PM Modi and French President Emmanuel Macron launched the 'Bharat Innovates 2026' initiative in Nice."
            };
            sessionStorage.setItem('analysisResult', JSON.stringify(mockData));
            window.location.reload();
        });
        return;
    }

    const originalData = JSON.parse(rawData);

    let radarChartInstance = null;
    let lineChartInstance = null;

    const banner = document.getElementById('pipeline-banner');
    const pipelineStatusEl = document.getElementById('pipeline-status');

    // Run verification pipeline
    let dataCopy = JSON.parse(JSON.stringify(originalData));
    const { correctedData, corrections } = verifyAndCorrectResultPipeline(dataCopy);

    // Update session storage so PDF exports reflect corrected values
    sessionStorage.setItem('analysisResult', JSON.stringify(correctedData));

    // Render
    displayResults(correctedData);

    if (banner && pipelineStatusEl) {
        banner.classList.remove('verifying');
        banner.classList.add('verified');
        if (corrections.length > 0) {
            pipelineStatusEl.innerHTML = `Resolved ${corrections.length} data discrepancies. Signals & scores updated.`;
        } else {
            pipelineStatusEl.innerHTML = `All data points consistent. Verification complete.`;
        }
    }


    // ============================================================
    // VERIFICATION PIPELINE — Validate & correct data consistency
    // ============================================================

    function verifyAndCorrectResultPipeline(data) {
        console.log("Running data verification pipeline...");
        let corrections = [];

        // 1. Ensure signals exist and are within 0-100
        if (!data.signals) {
            data.signals = {
                source_credibility: 50, evidence_strength: 50,
                cross_source_agreement: 50, author_expertise: 50,
                contradiction_score: 0, satire_markers: 0
            };
            corrections.push("Missing signals object, set defaults");
        } else {
            const signalKeys = ['source_credibility', 'evidence_strength', 'cross_source_agreement', 'author_expertise', 'contradiction_score', 'satire_markers'];
            for (const key of signalKeys) {
                if (data.signals[key] === undefined || data.signals[key] === null) {
                    data.signals[key] = 50;
                    corrections.push(`Signal ${key} missing, set to 50`);
                }
                data.signals[key] = Math.max(0, Math.min(100, Math.round(data.signals[key])));
            }
        }

        // 2. Recompute verdict_score from signals for consistency
        const sig = data.signals;
        const computedScore = Math.max(0, Math.min(100, Math.round(
            sig.source_credibility * 0.25 +
            sig.evidence_strength * 0.25 +
            sig.cross_source_agreement * 0.20 +
            sig.author_expertise * 0.15 +
            (100 - sig.contradiction_score) * 0.10 +
            (100 - sig.satire_markers) * 0.05
        )));

        if (data.verdict_score === undefined || data.verdict_score === null) {
            data.verdict_score = computedScore;
            corrections.push(`verdict_score missing, computed as ${computedScore}`);
        } else if (Math.abs(data.verdict_score - computedScore) > 5) {
            corrections.push(`verdict_score ${data.verdict_score} deviated from computed ${computedScore}, correcting`);
            data.verdict_score = computedScore;
        }

        // 3. Map verdict from score
        let expectedVerdict;
        if (sig.satire_markers >= 70) {
            expectedVerdict = "Satire / Fiction";
        } else if (data.verdict_score >= 80) {
            expectedVerdict = "Verified";
        } else if (data.verdict_score >= 60) {
            expectedVerdict = "Likely Verified";
        } else if (data.verdict_score >= 20) {
            expectedVerdict = "Unverified";
        } else if (data.verdict_score >= 5) {
            expectedVerdict = "Likely False";
        } else {
            expectedVerdict = "False";
        }

        if (data.verdict !== expectedVerdict) {
            corrections.push(`Verdict "${data.verdict}" corrected to "${expectedVerdict}" based on score ${data.verdict_score}`);
            data.verdict = expectedVerdict;
        }

        // 4. Validate sentences
        if (data.sentences) {
            data.sentences.forEach((s, idx) => {
                let trust = s.trust_score;
                if (trust === undefined || trust === null) {
                    trust = s.risk === 'High' ? 15 : s.risk === 'Medium' ? 50 : 85;
                    s.trust_score = trust;
                    corrections.push(`S${idx+1}: missing trust score, set to ${trust}`);
                }
                if (s.risk === 'Low' && trust < 70) {
                    s.trust_score = Math.max(trust, 75);
                    corrections.push(`S${idx+1}: Low risk but trust=${trust}, raised to ${s.trust_score}`);
                } else if (s.risk === 'High' && trust > 45) {
                    s.trust_score = Math.min(trust, 35);
                    corrections.push(`S${idx+1}: High risk but trust=${trust}, lowered to ${s.trust_score}`);
                }
            });
        }

        // 5. Validate spread risk / reach coherence
        if (!data.spread_risk) data.spread_risk = "Low";
        if (!data.estimated_reach) data.estimated_reach = "Low <1K";
        const risk = data.spread_risk;
        const reach = data.estimated_reach;
        if (risk === 'High' && (!reach.includes('Viral') && !reach.includes('1M+'))) {
            data.estimated_reach = 'Viral 1M+';
            corrections.push(`Spread risk/reach alignment corrected`);
        } else if (risk === 'Low' && (reach.includes('Viral') || reach.includes('1M+'))) {
            data.estimated_reach = 'Low <1K';
            corrections.push(`Spread risk/reach alignment corrected`);
        }

        return { correctedData: data, corrections };
    }


    // ============================================================
    // DISPLAY RESULTS — 6-Category Verdict System
    // ============================================================

    function displayResults(data) {
        const verdictScore = data.verdict_score || 0;
        const verdict = data.verdict || "Unverified";

        const statusBadge = document.getElementById('status-badge');
        const scoreRing = document.getElementById('score-ring');
        const verdictExplanation = document.getElementById('verdict-explanation');

        statusBadge.className = 'status-badge-hero';
        if (scoreRing) scoreRing.className = 'score-card-widget';

        // Map verdict to CSS class and display text
        const verdictConfig = {
            "Verified":         { cssClass: "verified",       icon: "shield-check",    label: "VERIFIED",        color: "var(--success)" },
            "Likely Verified":  { cssClass: "likely-verified", icon: "shield",          label: "LIKELY VERIFIED", color: "#00f0ff" },
            "Unverified":       { cssClass: "unverified",     icon: "help-circle",     label: "UNVERIFIED",      color: "var(--warning)" },
            "Likely False":     { cssClass: "likely-false",   icon: "alert-triangle",  label: "LIKELY FALSE",    color: "#ff9f1c" },
            "False":            { cssClass: "false",          icon: "shield-alert",    label: "FALSE",           color: "var(--danger)" },
            "Satire / Fiction": { cssClass: "satire",         icon: "laugh",           label: "SATIRE / FICTION", color: "#c77dff" },
        };

        const config = verdictConfig[verdict] || verdictConfig["Unverified"];

        statusBadge.innerHTML = `<i data-lucide="${config.icon}" style="width:16px; height:16px; vertical-align:middle; margin-right:4px;"></i> ${config.label}`;
        statusBadge.classList.add(config.cssClass);
        if (scoreRing) scoreRing.classList.add(config.cssClass);

        // Verdict explanation
        if (verdictExplanation) {
            verdictExplanation.textContent = data.explanation || `Score: ${verdictScore}/100`;
            verdictExplanation.style.borderLeftColor = config.color;
        }

        // Score display
        document.getElementById('credibility-value').textContent = `${verdictScore}`;
        const scoreFill = document.getElementById('score-fill');
        if (scoreFill) {
            setTimeout(() => { scoreFill.style.width = `${verdictScore}%`; }, 100);
        }

        // Meta row
        const verdictScoreDisplay = document.getElementById('verdict-score-display');
        if (verdictScoreDisplay) {
            verdictScoreDisplay.textContent = `${verdictScore}/100`;
        }

        const engineNameEl = document.getElementById('engine-name');
        if (engineNameEl) {
            engineNameEl.textContent = 'Gemini 2.5 Flash';
        }

        const spreadRisk = document.getElementById('spread-risk');
        if (spreadRisk) {
            const sRisk = data.spread_risk || 'Low';
            spreadRisk.textContent = sRisk;
            spreadRisk.className = sRisk === 'High' ? 'risk-high' : sRisk === 'Medium' ? 'risk-med' : 'risk-low';
        }

        const estReachEl = document.getElementById('est-reach');
        if (estReachEl) {
            estReachEl.textContent = data.estimated_reach || 'Low <1K';
        }

        // AI Generation Probability
        const prob = data.ai_generated_probability !== undefined ? data.ai_generated_probability : 0;
        const aiProbEl = document.getElementById('ai-prob');
        if (aiProbEl) aiProbEl.textContent = `${prob}%`;

        const aiFill = document.getElementById('ai-fill');
        if (aiFill) {
            aiFill.className = 'ai-fill-glow';
            if (prob <= 30) aiFill.classList.add('low');
            else if (prob <= 60) aiFill.classList.add('medium');
            else aiFill.classList.add('high');
        }
        setTimeout(() => {
            if (aiFill) {
                if (prob > 0) {
                    aiFill.style.width = `${prob}%`;
                    aiFill.style.minWidth = '6px';
                    aiFill.style.display = 'block';
                } else {
                    aiFill.style.width = '0%';
                    aiFill.style.minWidth = '0px';
                    aiFill.style.display = 'none';
                }
            }
        }, 100);

        // AI Verdict Text
        const aiVerdict = document.getElementById('ai-verdict');
        const aiIconBadge = document.getElementById('ai-verdict-icon');
        if (aiIconBadge && aiVerdict) {
            if (prob <= 20) {
                aiIconBadge.className = 'ai-icon-badge icon-success';
                aiIconBadge.innerHTML = '<i data-lucide="user"></i>';
                aiVerdict.innerHTML = '<strong>Clearly Human-Written</strong> — Strong natural voice, named sources';
            } else if (prob <= 40) {
                aiIconBadge.className = 'ai-icon-badge icon-info';
                aiIconBadge.innerHTML = '<i data-lucide="user-check"></i>';
                aiVerdict.innerHTML = '<strong>Likely Human-Written</strong> — Some polished editing detected';
            } else if (prob <= 60) {
                aiIconBadge.className = 'ai-icon-badge icon-ambiguous';
                aiIconBadge.innerHTML = '<i data-lucide="help-circle"></i>';
                aiVerdict.innerHTML = '<strong>Ambiguous</strong> — Could be human or AI assisted';
            } else if (prob <= 80) {
                aiIconBadge.className = 'ai-icon-badge icon-danger';
                aiIconBadge.innerHTML = '<i data-lucide="bot"></i>';
                aiVerdict.innerHTML = '<strong>Likely AI-Generated</strong> — Multiple AI writing patterns detected';
            } else {
                aiIconBadge.className = 'ai-icon-badge icon-critical';
                aiIconBadge.innerHTML = '<i data-lucide="alert-triangle"></i>';
                aiVerdict.innerHTML = '<strong>Almost Certainly AI-Generated</strong> — Highly artificial text patterns';
            }
        }

        // Manipulation Heatmap (important words)
        const wordsContainer = document.getElementById('important-words');
        wordsContainer.innerHTML = '';
        if (!data.important_words || data.important_words.length === 0) {
            wordsContainer.innerHTML = '<span style="color:#666;font-style:italic;">No specific keywords flagged.</span>';
        } else {
            data.important_words.forEach(word => {
                const span = document.createElement('span');
                span.className = 'imp-word';
                span.textContent = word;
                wordsContainer.appendChild(span);
            });
        }

        // Sentence Breakdown
        const sentencesContainer = document.getElementById('sentence-breakdown');
        sentencesContainer.innerHTML = '';
        const timelineLabels = [], timelineData = [];
        (data.sentences || []).forEach((s, idx) => {
            const div = document.createElement('div');
            div.className = `sent-box sent-${s.risk}`;
            div.innerHTML = `<strong>[${s.risk} Risk]</strong> ${s.text}`;
            sentencesContainer.appendChild(div);
            timelineLabels.push(`S${idx + 1}`);
            const trust = (s.trust_score !== undefined && s.trust_score !== null) ? Number(s.trust_score) : (s.risk === 'High' ? 15 : s.risk === 'Medium' ? 50 : 85);
            const suspicionLevel = 100 - trust;
            timelineData.push(suspicionLevel);
        });
        if (timelineLabels.length === 1) {
            timelineLabels[0] = 'Start'; timelineLabels.push('End'); timelineData.push(timelineData[0]);
        }

        // Claims Table
        const claimsList = document.getElementById('claims-list');
        claimsList.innerHTML = '';
        if (data.claims && data.claims.length > 0) {
            data.claims.forEach(c => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                let badgeClass = 'risk-low';
                if (c.verdict === 'False') badgeClass = 'risk-high';
                else if (c.verdict === 'Unverified') badgeClass = 'risk-med';
                tr.innerHTML = `
                    <td style="padding:0.75rem 0.5rem; color:var(--text-light);">${c.claim}</td>
                    <td style="padding:0.75rem 0.5rem;"><span class="${badgeClass}" style="font-weight:bold;">${c.verdict}</span></td>
                    <td style="padding:0.75rem 0.5rem; color:var(--text-muted); font-size:0.88rem;">${c.explanation}</td>
                `;
                claimsList.appendChild(tr);
            });
        } else {
            claimsList.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:1rem; color:var(--text-muted);">No claim extraction data available.</td></tr>';
        }

        // Contradictions
        const contradictionsContainer = document.getElementById('contradictions-warning-container');
        contradictionsContainer.innerHTML = '';
        const conScore = data.signals ? data.signals.contradiction_score : 0;
        document.getElementById('contradiction-score-val').textContent = conScore;

        if (data.contradictions && data.contradictions.length > 0) {
            data.contradictions.forEach(con => {
                const div = document.createElement('div');
                div.style.background = 'rgba(255,71,87,0.08)';
                div.style.borderLeft = '3px solid var(--danger)';
                div.style.padding = '0.75rem';
                div.style.borderRadius = '6px';
                div.style.marginBottom = '0.5rem';
                div.style.fontSize = '0.85rem';
                div.innerHTML = `
                    <div style="color:var(--danger); font-weight:bold; margin-bottom:0.25rem;"><i data-lucide="alert-triangle" style="width:14px; height:14px; vertical-align:middle; margin-right:4px;"></i> Conflict Flagged:</div>
                    <div style="color:var(--text-light); margin-bottom:0.25rem;"><b>A:</b> "${con.statement_a}"</div>
                    <div style="color:var(--text-light); margin-bottom:0.25rem;"><b>B:</b> "${con.statement_b}"</div>
                    <div style="color:var(--text-muted); font-style:italic;">Reason: ${con.explanation}</div>
                `;
                contradictionsContainer.appendChild(div);
            });
        } else {
            contradictionsContainer.innerHTML = '<div style="color:var(--success); font-size:0.88rem;"><i data-lucide="check-circle" style="width:14px; height:14px; vertical-align:middle; margin-right:4px; color:var(--success)"></i> No internal contradictions found. Consistent narrative.</div>';
        }

        // Temporal Score — now derived from contradiction signal
        const temporalContainer = document.getElementById('temporal-warning-container');
        temporalContainer.innerHTML = '';
        const tempScore = 100 - conScore; // Invert: low contradictions = high temporal consistency
        document.getElementById('temporal-score-val').textContent = `${tempScore}`;

        if (conScore > 30) {
            const div = document.createElement('div');
            div.style.background = 'rgba(255,183,77,0.08)';
            div.style.borderLeft = '3px solid var(--accent-orange)';
            div.style.padding = '0.75rem';
            div.style.borderRadius = '6px';
            div.style.marginBottom = '0.5rem';
            div.style.fontSize = '0.85rem';
            div.innerHTML = `
                <div style="color:var(--accent-orange); font-weight:bold; margin-bottom:0.25rem;"><i data-lucide="clock" style="width:14px; height:14px; vertical-align:middle; margin-right:4px;"></i> Consistency Warning:</div>
                <div style="color:var(--text-light);">Contradiction score is elevated (${conScore}%), indicating potential inconsistencies.</div>
            `;
            temporalContainer.appendChild(div);
        } else {
            temporalContainer.innerHTML = '<div style="color:var(--success); font-size:0.88rem;"><i data-lucide="check-circle" style="width:14px; height:14px; vertical-align:middle; margin-right:4px; color:var(--success)"></i> No consistency issues detected.</div>';
        }

        // Knowledge Graph
        const kgList = document.getElementById('kg-list');
        kgList.innerHTML = '';
        if (data.knowledge_graph && data.knowledge_graph.length > 0) {
            data.knowledge_graph.forEach(k => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                let badgeClass = k.verdict === 'Valid' ? 'risk-low' : k.verdict === 'Unverified' ? 'risk-med' : 'risk-high';
                tr.innerHTML = `
                    <td style="padding:0.5rem; color:var(--text-light);">
                        <span style="color:var(--accent-primary); font-weight:bold;">${k.subject}</span>
                        <span style="color:var(--text-muted); margin:0 0.3rem;">→</span> <span style="color:var(--text-light);">${k.predicate}</span>
                        <span style="color:var(--text-muted); margin:0 0.3rem;">→</span> <span style="color:#c77dff; font-weight:bold;">${k.object}</span>
                    </td>
                    <td style="padding:0.5rem;"><span class="${badgeClass}" style="font-weight:bold;">${k.verdict}</span></td>
                    <td style="padding:0.5rem; color:var(--text-muted); font-size:0.78rem;">${k.reason}</td>
                `;
                kgList.appendChild(tr);
            });
        } else {
            kgList.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:0.75rem; color:var(--text-muted);">No relation node data available.</td></tr>';
        }

        if (window.lucide) window.lucide.createIcons();

        renderCharts(data.signals, timelineLabels, timelineData);
    }


    // ============================================================
    // CHARTS — 6-Axis Verification Signals Radar + Suspicion Timeline
    // ============================================================

    function renderCharts(signals, labels, trustData) {
        Chart.defaults.color = '#c5c6c7';
        Chart.defaults.font.family = 'Inter';

        if (radarChartInstance) radarChartInstance.destroy();
        if (lineChartInstance) lineChartInstance.destroy();

        const sig = signals || {};
        const sc  = sig.source_credibility !== undefined ? sig.source_credibility : 0;
        const es  = sig.evidence_strength !== undefined ? sig.evidence_strength : 0;
        const csa = sig.cross_source_agreement !== undefined ? sig.cross_source_agreement : 0;
        const ae  = sig.author_expertise !== undefined ? sig.author_expertise : 0;
        // For the radar, show "Consistency" as inverse of contradiction
        const consistency = 100 - (sig.contradiction_score !== undefined ? sig.contradiction_score : 0);
        const sm  = sig.satire_markers !== undefined ? sig.satire_markers : 0;

        radarChartInstance = new Chart(document.getElementById('radarChart').getContext('2d'), {
            type: 'radar',
            data: {
                labels: ['Source Credibility', 'Evidence Strength', 'Cross-Source Agreement', 'Author Expertise', 'Consistency', 'Satire Markers'],
                datasets: [{
                    label: 'Verification Signals',
                    data: [sc, es, csa, ae, consistency, sm],
                    backgroundColor: 'rgba(102,252,241,0.2)',
                    borderColor: '#66fcf1',
                    pointBackgroundColor: '#45a29e',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    r: {
                        angleLines: { color: 'rgba(255,255,255,0.1)' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        pointLabels: { font: { size: 10 } },
                        ticks: { display: false },
                        min: 0,
                        max: 100
                    }
                },
                plugins: { legend: { display: false } }
            }
        });

        lineChartInstance = new Chart(document.getElementById('lineChart').getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Suspicion Level %',
                    data: trustData,
                    borderColor: '#ff4757',
                    backgroundColor: 'rgba(255,71,87,0.1)',
                    borderWidth: 3, fill: true, tension: 0.4,
                    pointRadius: 5, pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' } },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }


    // ============================================================
    // PDF EXPORT
    // ============================================================

    document.getElementById('download-pdf-btn').addEventListener('click', async () => {
        const rawData = sessionStorage.getItem('analysisResult');
        if (!rawData) return;
        const response = await fetch('/api/export/pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: rawData
        });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'TruthLens_Verification_Report.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } else {
            alert('Failed to generate PDF report.');
        }
    });

});
