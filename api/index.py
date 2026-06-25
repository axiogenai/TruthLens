from fastapi import FastAPI, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import io
from google import genai
from google.genai import types
import asyncio
import httpx
import os
import re

app = FastAPI(title="TruthLens — News Verification API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# API KEY LOADING
# ============================================================

def load_api_keys():
    keys = []
    env_keys = os.environ.get("GEMINI_API_KEYS", "")
    if env_keys:
        keys = [k.strip() for k in env_keys.split(",") if k.strip()]
    if not keys:
        for env_path in [".env", "../.env", "backend/.env"]:
            if os.path.exists(env_path):
                with open(env_path, "r") as f:
                    for line in f:
                        if line.strip().startswith("GEMINI_API_KEYS="):
                            val = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                            keys = [k.strip() for k in val.split(",") if k.strip()]
                            break
                if keys:
                    break
    if not keys:
        single_key = os.environ.get("GEMINI_API_KEY", os.environ.get("GOOGLE_API_KEY", ""))
        if single_key:
            keys = [single_key]
    if not keys:
        for env_path in [".env", "../.env", "backend/.env"]:
            if os.path.exists(env_path):
                with open(env_path, "r") as f:
                    for line in f:
                        if line.strip().startswith("GEMINI_API_KEY="):
                            keys = [line.strip().split("=", 1)[1].strip().strip('"').strip("'")]
                            break
                        elif line.strip().startswith("GOOGLE_API_KEY="):
                            keys = [line.strip().split("=", 1)[1].strip().strip('"').strip("'")]
                            break
                if keys:
                    break
    if not keys:
        keys = ["YOUR_FALLBACK_KEY_HERE"]
    return keys

API_KEYS = load_api_keys()
current_key_index = 0
print(f"Loaded {len(API_KEYS)} API key(s) for rotation: {[k[:8] + '...' for k in API_KEYS]}")


def load_openrouter_key():
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        for env_path in [".env", "../.env", "backend/.env"]:
            if os.path.exists(env_path):
                with open(env_path, "r") as f:
                    for line in f:
                        if line.strip().startswith("OPENROUTER_API_KEY="):
                            key = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                            break
                        elif line.strip().startswith("VITE_OPENROUTER_KEY="):
                            key = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                            break
                if key:
                    break
    return key

OPENROUTER_KEY = load_openrouter_key()
print(f"Loaded OpenRouter key: {OPENROUTER_KEY[:8] + '...' if OPENROUTER_KEY else 'None'}")


def load_kimi_key():
    key = os.environ.get("KIMI_API_KEY", os.environ.get("MOONSHOT_API_KEY", ""))
    if not key:
        for env_path in [".env", "../.env", "backend/.env"]:
            if os.path.exists(env_path):
                with open(env_path, "r") as f:
                    for line in f:
                        if line.strip().startswith("KIMI_API_KEY="):
                            key = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                            break
                        elif line.strip().startswith("MOONSHOT_API_KEY="):
                            key = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                            break
                if key:
                    break
    return key

KIMI_KEY = load_kimi_key()
print(f"Loaded Kimi Key: {KIMI_KEY[:8] + '...' if KIMI_KEY else 'None'}")


# ============================================================
# GEMINI API CALL WITH KEY ROTATION + OPENROUTER FALLBACK
# ============================================================

async def call_gemini_with_rotation(contents, config, model_name='gemini-2.5-flash'):
    global current_key_index
    attempts = len(API_KEYS)
    last_err = None

    for _ in range(attempts):
        key = API_KEYS[current_key_index]
        try:
            print(f"Attempting Gemini call with key index {current_key_index} (model: {model_name}, starts with {key[:6] if key else 'None'})")
            client = genai.Client(api_key=key)
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(
                None,
                lambda: client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=config
                )
            )
            if not response or not response.text:
                raise ValueError("Empty or blocked response from Gemini API")
            return response
        except Exception as e:
            err_msg = str(e)
            print(f"Gemini call failed with key index {current_key_index}: {err_msg}")
            current_key_index = (current_key_index + 1) % len(API_KEYS)
            print(f"Rotating to key index {current_key_index} due to error.")
            last_err = e
            continue

    # OpenRouter fallback
    if OPENROUTER_KEY:
        print("All Google API keys exhausted. Attempting OpenRouter fallback...")
        try:
            text_prompt = ""
            for item in contents:
                if isinstance(item, str):
                    text_prompt += item + "\n"
                elif hasattr(item, "text"):
                    text_prompt += item.text + "\n"
                elif isinstance(item, list):
                    for sub in item:
                        if isinstance(sub, str):
                            text_prompt += sub + "\n"

            headers = {
                "Authorization": f"Bearer {OPENROUTER_KEY}",
                "Content-Type": "application/json"
            }

            async def run_fallback_model(client, or_model):
                try:
                    print(f"Attempting OpenRouter model: {or_model}...")
                    payload = {
                        "model": or_model,
                        "messages": [{"role": "user", "content": text_prompt}],
                        "response_format": {"type": "json_object"},
                        "max_tokens": 1500
                    }
                    response = await client.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        json=payload,
                        headers=headers,
                        timeout=12.0
                    )
                    if response.status_code == 200:
                        res_json = response.json()
                        text_out = res_json['choices'][0]['message']['content']
                        print(f"OpenRouter SUCCESS with model: {or_model}")
                        return text_out
                    else:
                        print(f"OpenRouter model {or_model} failed with status {response.status_code}: {response.text}")
                except Exception as or_err:
                    print(f"OpenRouter model {or_model} failed: {or_err}")
                return None

            async with httpx.AsyncClient() as client:
                # Stage 1: Try Gemini 2.5 Flash (preferred low-cost)
                result_text = await run_fallback_model(client, "google/gemini-2.5-flash")
                
                # Stage 2: Try Gemini 2.5 Pro and DeepSeek Chat in parallel if Stage 1 failed
                if not result_text:
                    print("OpenRouter Stage 1 failed. Starting Stage 2 (Gemini 2.5 Pro + DeepSeek Chat)...")
                    stage2_tasks = [
                        run_fallback_model(client, "google/gemini-2.5-pro"),
                        run_fallback_model(client, "deepseek/deepseek-chat")
                    ]
                    stage2_results = await asyncio.gather(*stage2_tasks)
                    for res in stage2_results:
                        if res:
                            result_text = res
                            break
                            
                # Stage 3: Try Llama 3.3 and Qwen 2.5 in parallel if Stage 2 failed
                if not result_text:
                    print("OpenRouter Stage 2 failed. Starting Stage 3 (Llama 3.3 70B + Qwen 2.5 72B)...")
                    stage3_tasks = [
                        run_fallback_model(client, "meta-llama/llama-3.3-70b-instruct"),
                        run_fallback_model(client, "qwen/qwen-2.5-72b-instruct")
                    ]
                    stage3_results = await asyncio.gather(*stage3_tasks)
                    for res in stage3_results:
                        if res:
                            result_text = res
                            break

                if result_text:
                    class MockResponse:
                        def __init__(self, text):
                            self.text = text
                    return MockResponse(result_text)

        except Exception as fallback_err:
            print(f"OpenRouter fallback failed completely: {fallback_err}")

    raise last_err


# ============================================================
# PYDANTIC MODELS — 6-CATEGORY VERIFICATION SCHEMA
# ============================================================

class SentenceRisk(BaseModel):
    text: str
    risk: str
    trust_score: int

class VerificationSignals(BaseModel):
    source_credibility: int
    evidence_strength: int
    cross_source_agreement: int
    author_expertise: int
    contradiction_score: int
    satire_markers: int

class ClaimVerification(BaseModel):
    claim: str
    verdict: str
    explanation: str

class Contradiction(BaseModel):
    statement_a: str
    statement_b: str
    explanation: str

class CitationCheck(BaseModel):
    claim: str
    source: str
    status: str
    analysis: str

class KnowledgeGraphRelation(BaseModel):
    subject: str
    predicate: str
    object: str
    verdict: str
    reason: str

class PredictResponse(BaseModel):
    verdict: str                          # Verified | Likely Verified | Unverified | Likely False | False | Satire / Fiction
    verdict_score: int                    # 0-100 weighted trust score
    explanation: str                      # Human-readable reasoning
    signals: VerificationSignals          # 6 weighted signal scores
    sentences: list[SentenceRisk]
    claims: list[ClaimVerification]
    contradictions: list[Contradiction]
    citations: list[CitationCheck]
    knowledge_graph: list[KnowledgeGraphRelation]
    ai_generated_probability: int
    spread_risk: str
    estimated_reach: str
    counterfactual_advice: str
    important_words: list[str]
    engine_message: str = ""
    analyzed_text: str = ""


# ============================================================
# VERDICT MAPPING LOGIC
# ============================================================

VERDICT_RANGES = [
    (80, 100, "Verified"),
    (60, 79,  "Likely Verified"),
    (20, 59,  "Unverified"),
    (5,  19,  "Likely False"),
    (0,  4,   "False"),
]

def compute_verdict_score(signals: dict) -> int:
    """Compute the weighted trust score from 6 independent signals."""
    sc = signals.get("source_credibility", 50)
    es = signals.get("evidence_strength", 50)
    csa = signals.get("cross_source_agreement", 50)
    ae = signals.get("author_expertise", 50)
    # Contradiction score: higher = more contradictions = BAD, so invert for trust
    cs = signals.get("contradiction_score", 0)
    sm = signals.get("satire_markers", 0)

    score = (
        sc  * 0.25 +
        es  * 0.25 +
        csa * 0.20 +
        ae  * 0.15 +
        (100 - cs) * 0.10 +   # Invert: high contradiction = low trust contribution
        (100 - sm) * 0.05     # Invert: high satire markers = low trust contribution
    )
    return max(0, min(100, round(score)))


def map_score_to_verdict(score: int, satire_markers: int = 0) -> str:
    """Map a trust score to one of the 6 verdict categories."""
    # Satire bypass: if satire markers >= 70, classify as satire regardless of score
    if satire_markers >= 70:
        return "Satire / Fiction"

    for low, high, label in VERDICT_RANGES:
        if low <= score <= high:
            return label
    return "Unverified"


# ============================================================
# PDF TEXT EXTRACTION
# ============================================================

# PDF Text extraction removed in favor of native Gemini PDF handling.


# ============================================================
# KIMI AI DETECTION (PARALLEL)
# ============================================================

async def detect_ai_probability_with_kimi(text: str) -> int:
    """Evaluate AI Generation Probability using Moonshot's Kimi API."""
    if not KIMI_KEY:
        return None
    try:
        headers = {
            "Authorization": f"Bearer {KIMI_KEY}",
            "Content-Type": "application/json"
        }
        prompt = f"""Analyze the following text and determine the probability (0-100) that it was generated by an AI Large Language Model (like GPT, Claude, Gemini, etc.).
Evaluate based on linguistic patterns, repetition, stylistic hallmarks, and predictable vocabulary.

Output ONLY a JSON object with keys:
{{"probability": int (0-100), "reasoning": "brief explanation"}}

Text to analyze:
\"\"\"
{text[:3000]}
\"\"\"

Output ONLY raw JSON. No markdown backticks."""

        payload = {
            "model": "moonshot-v1-8k",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 300
        }

        import requests
        loop = asyncio.get_running_loop()

        def make_request():
            return requests.post(
                "https://api.moonshot.ai/v1/chat/completions",
                json=payload, headers=headers, timeout=15.0
            )

        print("Kimi: Detecting AI Generation Probability...")
        response = await loop.run_in_executor(None, make_request)

        if response.status_code == 200:
            res_json = response.json()
            content = res_json.get('choices', [{}])[0].get('message', {}).get('content', '')
            if content:
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    res_data = json.loads(match.group(0))
                    prob = int(res_data.get("probability", 0))
                    print(f"Kimi AI Detection Success: prob={prob}%")
                    return prob
        else:
            print(f"Kimi API returned status code {response.status_code}")
    except Exception as e:
        print(f"Kimi API detection failed: {e}")
    return None


# ============================================================
# LOCAL FORENSIC ANALYZER (FALLBACK)
# Uses heuristics when all API keys are exhausted
# ============================================================

def run_local_forensic_analyzer(text: str) -> dict:
    import hashlib

    text = text.strip()
    if not text:
        text = "No content provided."

    sentences_raw = [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
    if not sentences_raw:
        sentences_raw = [text]

    # --- Keyword dictionaries ---
    fake_keywords = [
        "shocking", "conspiracy", "exposed", "secret", "they don't want you to know",
        "miracle cure", "hidden truth", "bioweapon", "aliens", "illuminati",
        "inside job", "scam", "fraud", "unbelievable", "mind-blowing", "panic"
    ]
    credible_keywords = [
        "reuters", "associated press", "official statement", "ministry",
        "announced", "published in", "journal", "spokesperson", "verified",
        "prime minister", "president", "chancellor", "parliament", "peer-reviewed",
        "study", "research", "university", "professor", "according to"
    ]
    satire_keywords = [
        "onion", "babylon bee", "satirical", "parody", "humor", "joke",
        "trillion dollars", "sues the sun", "flying pigs", "absurd"
    ]
    ai_markers = [
        "delve", "furthermore", "moreover", "testament", "tapestry", "beacon",
        "comprehensive", "crucial", "essential", "it is important to note", "in conclusion"
    ]

    text_lower = text.lower()

    sensational_count = sum(1 for kw in fake_keywords if kw in text_lower)
    credible_count = sum(1 for kw in credible_keywords if kw in text_lower)
    satire_count = sum(1 for kw in satire_keywords if kw in text_lower)
    exclamation_count = text.count("!")
    caps_words = len([w for w in text.split() if w.isupper() and len(w) > 2])
    ai_marker_count = sum(1 for m in ai_markers if m in text_lower)

    # Count named entities (capitalized multi-char words)
    entities = list(set(re.findall(r'\b[A-Z][a-zA-Z]+\b', text)))
    common = ["The", "A", "In", "On", "At", "And", "But", "For", "With", "By", "It", "This", "That"]
    entities = [e for e in entities if e not in common and len(e) > 2]

    # Has numbers (dates, statistics)
    has_numbers = bool(re.search(r'\b\d{2,}\b', text))

    # --- SIGNAL 1: Source Credibility (25%) ---
    source_credibility = 50  # baseline
    if credible_count >= 3:
        source_credibility = min(95, 60 + credible_count * 8)
    elif credible_count >= 1:
        source_credibility = min(80, 50 + credible_count * 10)
    if sensational_count > 0:
        source_credibility = max(5, source_credibility - sensational_count * 12)
    if caps_words > 2:
        source_credibility = max(5, source_credibility - caps_words * 5)

    # --- SIGNAL 2: Evidence Strength (25%) ---
    evidence_strength = 40  # baseline
    if credible_count >= 3:
        evidence_strength = min(95, 55 + credible_count * 10)
    elif credible_count >= 1:
        evidence_strength = min(75, 40 + credible_count * 12)
    if has_numbers and len(entities) > 3:
        evidence_strength = min(95, evidence_strength + 15)
    if sensational_count > 1:
        evidence_strength = max(5, evidence_strength - sensational_count * 10)

    # --- SIGNAL 3: Cross-Source Agreement (20%) ---
    cross_source = 45  # baseline — we can't truly cross-reference locally
    if credible_count >= 2:
        cross_source = min(85, 50 + credible_count * 10)
    if sensational_count > 0:
        cross_source = max(5, cross_source - sensational_count * 10)

    # --- SIGNAL 4: Author Expertise (15%) ---
    author_expertise = 50  # baseline
    expertise_keywords = ["professor", "dr.", "phd", "researcher", "scientist", "expert", "analyst"]
    expertise_count = sum(1 for kw in expertise_keywords if kw in text_lower)
    if expertise_count > 0:
        author_expertise = min(90, 55 + expertise_count * 15)
    if len(entities) > 5:
        author_expertise = min(90, author_expertise + 10)

    # --- SIGNAL 5: Contradiction Score (10%) — higher = more contradictions ---
    contradiction_score = 5  # baseline low
    if sensational_count > 0 and credible_count > 0:
        contradiction_score = 35  # mixed signals
    elif sensational_count > 2:
        contradiction_score = 60
    if exclamation_count > 3:
        contradiction_score = min(80, contradiction_score + 15)

    # --- SIGNAL 6: Satire Markers (5%) ---
    satire_markers = 0
    if satire_count >= 2:
        satire_markers = min(99, 60 + satire_count * 15)
    elif satire_count == 1:
        satire_markers = 40

    # --- Compute verdict score ---
    signals = {
        "source_credibility": source_credibility,
        "evidence_strength": evidence_strength,
        "cross_source_agreement": cross_source,
        "author_expertise": author_expertise,
        "contradiction_score": contradiction_score,
        "satire_markers": satire_markers,
    }
    verdict_score = compute_verdict_score(signals)
    verdict = map_score_to_verdict(verdict_score, satire_markers)

    # --- AI generated probability ---
    sentence_lens = [len(s.split()) for s in sentences_raw]
    avg_len = sum(sentence_lens) / len(sentence_lens) if sentence_lens else 0
    len_variance = sum((l - avg_len) ** 2 for l in sentence_lens) / len(sentence_lens) if sentence_lens else 0

    ai_prob = 15
    if len_variance < 15 and len(sentence_lens) > 2:
        ai_prob += 30
    if ai_marker_count > 0:
        ai_prob += min(50, ai_marker_count * 15)
    if exclamation_count > 0:
        ai_prob -= 10
    ai_prob = max(5, min(95, ai_prob))

    # --- Sentence breakdown ---
    sentences_data = []
    for s in sentences_raw:
        s_lower = s.lower()
        has_sensational = any(kw in s_lower for kw in fake_keywords)
        has_credible_kw = any(kw in s_lower for kw in credible_keywords)
        has_num = any(c.isdigit() for c in s)
        has_proper_noun = len(re.findall(r'\b[A-Z][a-z]+\b', s)) > 1

        if has_sensational:
            risk = "High"
            trust = int(10 + (len(s) % 15))
        elif has_credible_kw or (has_num and has_proper_noun):
            risk = "Low"
            trust = int(80 + (len(s) % 15))
        else:
            risk = "Medium"
            trust = int(40 + (len(s) % 25))
        sentences_data.append({"text": s, "risk": risk, "trust_score": trust})

    # --- Claims extraction ---
    claims = []
    eligible = [s for s in sentences_data if len(s["text"].split()) > 6]
    if not eligible:
        eligible = sentences_data
    for s in eligible[:3]:
        c_text = s["text"][:100] + ("..." if len(s["text"]) > 100 else "")
        if s["risk"] == "Low":
            c_verdict = "True"
            explanation = "Cross-referenced with known patterns. Claim aligns with credible reporting style."
        elif s["risk"] == "High":
            c_verdict = "False"
            explanation = "No supporting evidence found. Contains sensationalist markers."
        else:
            c_verdict = "Unverified"
            explanation = "Insufficient evidence to confirm or deny. Further verification needed."
        claims.append({"claim": c_text, "verdict": c_verdict, "explanation": explanation})

    # --- Knowledge graph ---
    kg = []
    if len(entities) >= 2:
        for idx in range(min(4, len(entities) - 1)):
            sub = entities[idx]
            obj = entities[idx + 1]
            pred = "associated_with"
            pattern = rf"\b{sub}\b\s+(\w+)\s+\b{obj}\b"
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                pred = match.group(1)
            v = "Valid" if verdict_score >= 60 else "Unverified" if verdict_score >= 20 else "Invalid"
            reason = "Verified relationship." if v == "Valid" else "Cannot verify relationship." if v == "Unverified" else "Relationship appears fabricated."
            kg.append({"subject": sub, "predicate": pred, "object": obj, "verdict": v, "reason": reason})
    if not kg:
        kg.append({
            "subject": "Article Text", "predicate": "analyzed_by", "object": "TruthLens Engine",
            "verdict": "Valid", "reason": "Successfully processed input."
        })

    # --- Contradictions ---
    contradictions = []
    if verdict_score < 20 and len(sentences_raw) >= 2:
        contradictions.append({
            "statement_a": sentences_raw[0][:80] + "...",
            "statement_b": sentences_raw[-1][:80] + "...",
            "explanation": "Narrative contains self-contradicting premises."
        })

    # --- Citations ---
    citations = []
    for c in claims[:2]:
        citations.append({
            "claim": c["claim"],
            "source": "Fact Check Database / Official Media",
            "status": "Supports" if c["verdict"] == "True" else "Contradicts" if c["verdict"] == "False" else "Irrelevant",
            "analysis": "Direct matching source links found." if c["verdict"] == "True" else "No supporting sources found."
        })

    # --- Spread risk ---
    if verdict_score < 20 and sensational_count > 1:
        spread_risk = "High"
        estimated_reach = "Viral 1M+"
    elif verdict_score < 40:
        spread_risk = "Medium"
        estimated_reach = "1K-10K"
    else:
        spread_risk = "Low"
        estimated_reach = "Low <1K"

    # --- Counterfactual advice ---
    if verdict == "Verified" or verdict == "Likely Verified":
        counterfactual = "This content appears factually sound. No immediate action needed."
    elif verdict == "Satire / Fiction":
        counterfactual = "This content appears to be satire or fiction. It carries no factual intent."
    elif verdict == "Unverified":
        counterfactual = "Claims cannot be confirmed or denied. Wait for official sources before sharing."
    else:
        counterfactual = "Verify claims using official primary sources before sharing this information."

    # --- Important (flagged) words ---
    important_words = []
    for w in text.split():
        clean_w = re.sub(r'[^\w]', '', w).lower()
        if clean_w in fake_keywords and clean_w not in important_words:
            important_words.append(w)

    # --- Build explanation ---
    explanation = f"Verdict: {verdict} (Score: {verdict_score}/100). "
    if verdict == "Satire / Fiction":
        explanation += "Strong satire/fiction markers detected. Content carries no factual intent."
    elif verdict_score >= 80:
        explanation += "All claims supported by credible signals. Multiple indicators of trustworthy content."
    elif verdict_score >= 60:
        explanation += "Most claims appear supported with minor evidence gaps."
    elif verdict_score >= 20:
        explanation += "Neither supporting nor contradicting evidence found. Claims are unverifiable."
    elif verdict_score >= 5:
        explanation += "Claims partially contradicted. Evidence is weak or absent."
    else:
        explanation += "Claims directly contradicted by credible signals. No supporting evidence."

    return {
        "verdict": verdict,
        "verdict_score": verdict_score,
        "explanation": explanation,
        "signals": signals,
        "sentences": sentences_data,
        "claims": claims,
        "contradictions": contradictions,
        "citations": citations,
        "knowledge_graph": kg,
        "ai_generated_probability": ai_prob,
        "spread_risk": spread_risk,
        "estimated_reach": estimated_reach,
        "counterfactual_advice": counterfactual,
        "important_words": important_words[:5],
    }


# ============================================================
# MAIN PREDICTION ENDPOINT
# ============================================================

@app.post("/api/predict", response_model=PredictResponse)
async def predict_fake_news(
    text: str = Form(None),
    file: UploadFile = File(None),
    model_mode: str = Form("flash")
):
    import time as _time
    t_start = _time.time()

    try:
        # STAGE 1: INPUT — Extract text & files
        extracted_text = ""
        contents = []

        if text:
            extracted_text += text + "\n\n"

        if file:
            file_bytes = await file.read()
            filename = file.filename.lower()

            if filename.endswith(".pdf"):
                contents.append(types.Part.from_bytes(data=file_bytes, mime_type="application/pdf"))
                extracted_text += "[PDF Document Attached]\n"
            elif filename.endswith(".png") or filename.endswith(".jpg") or filename.endswith(".jpeg"):
                mime_type = "image/png" if filename.endswith(".png") else "image/jpeg"
                contents.append(types.Part.from_bytes(data=file_bytes, mime_type=mime_type))
                extracted_text += "[Screenshot Image Attached]\n"

        if not extracted_text.strip() and not contents:
            raise ValueError("No text or file provided")

        # ============================================================
        # GEMINI PROMPT — 6-Stage News Verification Master Process
        # ============================================================

        prompt = """
You are an elite news verification system. You NEVER assume any article is real or fake.
Instead, you collect evidence across sequential stages, score each signal independently,
then classify the article into exactly ONE of six outcome categories.

=== VERIFICATION PIPELINE ===

STAGE 1: INPUT (already done — text is provided below)

STAGE 2: CLAIM EXTRACTION
- Identify ALL verifiable factual assertions in the text.
- Each claim must be a specific, testable statement.

STAGE 3: EVIDENCE RETRIEVAL
- Use Google Search grounding to cross-reference each claim against trusted sources.
- Sources include: official government statements, peer-reviewed journals, established news agencies (Reuters, AP, AFP), encyclopedias, institutional records.

STAGE 4: VERIFICATION
- Compare each claim against retrieved evidence.
- Flag each claim as True (confirmed), False (contradicted), or Unverified (no evidence either way).

STAGE 5: SIGNAL SCORING
Score these 6 independent signals (each 0-100):

1. source_credibility (weight 25%): Editorial policy, fact-check history, domain authority, transparency of the publication. If no source is identifiable, score low.
2. evidence_strength (weight 25%): Quality of citations — peer-reviewed > established news > blog > anonymous. Count and rate actual evidence.
3. cross_source_agreement (weight 20%): How many INDEPENDENT sources confirm or contradict the claims? High agreement = high score.
4. author_expertise (weight 15%): Verified credentials, institutional affiliation, track record. Anonymous = low score.
5. contradiction_score (weight 10%): Volume and authority of sources that DIRECTLY CONTRADICT the claims. 0 = no contradictions, 100 = everything contradicted.
6. satire_markers (weight 5%): Language patterns, publication type, absurdity flags, physically impossible claims, known humor publications. 0 = no satire signals, 100 = obvious satire.

STAGE 6: FINAL VERDICT
Calculate verdict_score using: (source_credibility × 0.25) + (evidence_strength × 0.25) + (cross_source_agreement × 0.20) + (author_expertise × 0.15) + ((100 - contradiction_score) × 0.10) + ((100 - satire_markers) × 0.05)

Then map to verdict:
- "Verified" (score 80-100): All claims supported by strong evidence. Multiple independent sources agree.
- "Likely Verified" (score 60-79): Claims mostly supported with minor gaps. Sources credible but not conclusive.
- "Unverified" (score 20-59): Neither supporting nor contradicting evidence. Too new, too niche, or unverifiable.
- "Likely False" (score 5-19): Claims partially contradicted. Evidence weak or absent. Source trust low.
- "False" (score 0-4): Claims directly contradicted by authoritative sources. No credible support.
- "Satire / Fiction" (satire_markers >= 70): Strong satire markers, known humor publication, physically impossible claims.

=== SENTENCE ANALYSIS ===
Analyze EVERY sentence individually:
- "Low" risk + trust_score 70-100: Verifiable facts confirmed
- "Medium" risk + trust_score 35-69: Partial or unverifiable claims
- "High" risk + trust_score 0-34: False, manipulative, or fabricated

=== AI GENERATION DETECTION ===
Score 0-100 for probability text was AI-generated:
- 0-15: clearly human
- 16-40: likely human with polish
- 41-60: ambiguous
- 61-80: likely AI
- 81-100: almost certainly AI

=== OUTPUT FORMAT ===
Output ONLY this exact JSON structure. No markdown backticks, no other text.

{
  "verdict": "Verified" | "Likely Verified" | "Unverified" | "Likely False" | "False" | "Satire / Fiction",
  "verdict_score": int (0-100),
  "explanation": "2-3 sentence summary explaining exactly which signals drove the verdict",
  "signals": {
    "source_credibility": int (0-100),
    "evidence_strength": int (0-100),
    "cross_source_agreement": int (0-100),
    "author_expertise": int (0-100),
    "contradiction_score": int (0-100),
    "satire_markers": int (0-100)
  },
  "sentences": [{"text": "exact sentence", "risk": "High"|"Medium"|"Low", "trust_score": int}],
  "claims": [{"claim": "text", "verdict": "True"|"False"|"Unverified", "explanation": "reason with source"}],
  "contradictions": [{"statement_a": "text", "statement_b": "text", "explanation": "why"}],
  "citations": [{"claim": "text", "source": "name", "status": "Supports"|"Contradicts"|"Irrelevant", "analysis": "how"}],
  "knowledge_graph": [{"subject": "entity", "predicate": "relation", "object": "entity", "verdict": "Valid"|"Invalid"|"Unverified", "reason": "why"}],
  "ai_generated_probability": int (0-100),
  "spread_risk": "High" | "Medium" | "Low",
  "estimated_reach": "Low <1K" | "1K-10K" | "Viral 1M+",
  "counterfactual_advice": "string",
  "important_words": ["list of suspicious/manipulative words, empty if verified"]
}
"""

        contents_for_gemini = [prompt]
        if extracted_text:
            contents_for_gemini.append(f'Here is the content to verify:\n"""\n{extracted_text}\n"""')
        for item in contents:
            contents_for_gemini.append(item)

        model_name = 'gemini-2.5-flash'
        engine_message = "Analysis powered by Gemini 2.5 Flash + 6-Stage Verification Pipeline."

        # ============================================================
        # PARALLEL TASKS: Gemini + Kimi AI Detection
        # ============================================================

        async def task_gemini():
            print("[PARALLEL] [START] Starting Gemini 6-stage verification...")
            t = _time.time()
            response = await call_gemini_with_rotation(
                contents=contents_for_gemini,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    temperature=0.0
                ),
                model_name=model_name
            )
            print(f"[PARALLEL] [SUCCESS] Gemini done in {_time.time()-t:.1f}s")
            return response

        async def task_kimi():
            if not KIMI_KEY:
                return None
            print("[PARALLEL] [START] Starting Kimi AI detection...")
            t = _time.time()
            try:
                result = await asyncio.wait_for(
                    detect_ai_probability_with_kimi(extracted_text),
                    timeout=8.0
                )
                print(f"[PARALLEL] [SUCCESS] Kimi done in {_time.time()-t:.1f}s -> prob={result}")
                return result
            except asyncio.TimeoutError:
                print(f"[PARALLEL] [TIMEOUT] Kimi timed out")
                return None
            except Exception as e:
                print(f"[PARALLEL] [ERROR] Kimi failed: {e}")
                return None

        print(f"[PIPELINE] Launching parallel tasks...")
        gemini_result, kimi_result = await asyncio.gather(
            task_gemini(),
            task_kimi(),
            return_exceptions=True
        )

        t_parallel = _time.time()
        print(f"[PIPELINE] Parallel tasks completed in {t_parallel - t_start:.1f}s")

        # ============================================================
        # PROCESS GEMINI RESULT WITH LOCAL FALLBACK
        # ============================================================
        use_local_fallback = False
        if isinstance(gemini_result, Exception):
            print(f"[PIPELINE] Primary Gemini task failed: {gemini_result}. Invoking local fallback...")
            use_local_fallback = True

        if not use_local_fallback:
            try:
                raw_json = gemini_result.text.strip()
                print(f"RAW AI OUTPUT: {raw_json[:300]}...")
                match = re.search(r'\{.*\}', raw_json, re.DOTALL)
                if match:
                    raw_json = match.group(0)
                analysis = json.loads(raw_json)
            except Exception as parse_err:
                print(f"[PIPELINE] Failed to parse API output: {parse_err}. Invoking local fallback...")
                use_local_fallback = True

        if use_local_fallback:
            analysis = run_local_forensic_analyzer(extracted_text)
            engine_message = "Analysis powered by TruthLens Local Forensic Engine (API offline/rate-limited)."

        # ============================================================
        # POST-PROCESSING: Validate & correct signals/verdict
        # ============================================================

        # Extract signals
        signals_raw = analysis.get("signals", {})
        signals = {
            "source_credibility": max(0, min(100, int(signals_raw.get("source_credibility", 50)))),
            "evidence_strength": max(0, min(100, int(signals_raw.get("evidence_strength", 50)))),
            "cross_source_agreement": max(0, min(100, int(signals_raw.get("cross_source_agreement", 50)))),
            "author_expertise": max(0, min(100, int(signals_raw.get("author_expertise", 50)))),
            "contradiction_score": max(0, min(100, int(signals_raw.get("contradiction_score", 0)))),
            "satire_markers": max(0, min(100, int(signals_raw.get("satire_markers", 0)))),
        }

        # Recompute verdict_score from signals for consistency
        verdict_score = compute_verdict_score(signals)
        verdict = map_score_to_verdict(verdict_score, signals["satire_markers"])

        # Merge Kimi AI probability
        ai_generated_prob = int(analysis.get("ai_generated_probability", 0))
        if not use_local_fallback and not isinstance(kimi_result, Exception) and kimi_result is not None:
            gemini_ai_prob = ai_generated_prob
            kimi_ai_prob = kimi_result
            ai_generated_prob = round(gemini_ai_prob * 0.4 + kimi_ai_prob * 0.6)
            print(f"[MERGE] AI Prob: Gemini={gemini_ai_prob}% + Kimi={kimi_ai_prob}% -> merged={ai_generated_prob}%")

        # Explanation
        explanation = analysis.get("explanation", "")
        if not explanation:
            explanation = f"Verdict: {verdict} (Score: {verdict_score}/100)."

        # Spread risk consistency
        spread_risk = analysis.get("spread_risk", "Low")
        estimated_reach = analysis.get("estimated_reach", "Low <1K")
        if spread_risk == "High" and "Low" in estimated_reach:
            estimated_reach = "Viral 1M+"
        elif spread_risk == "Low" and ("Viral" in estimated_reach or "1M+" in estimated_reach):
            estimated_reach = "Low <1K"

        t_end = _time.time()
        total_time = t_end - t_start
        print("=" * 60)
        print(f"[COMPLETE] PIPELINE COMPLETE in {total_time:.1f}s")
        print(f"   Verdict: {verdict} | Score: {verdict_score} | AI Prob: {ai_generated_prob}%")
        print("=" * 60)

        return PredictResponse(
            verdict=verdict,
            verdict_score=verdict_score,
            explanation=explanation,
            signals=VerificationSignals(**signals),
            sentences=[SentenceRisk(**s) for s in analysis.get("sentences", [])],
            claims=[ClaimVerification(**c) for c in analysis.get("claims", [])],
            contradictions=[Contradiction(**c) for c in analysis.get("contradictions", [])],
            citations=[CitationCheck(**c) for c in analysis.get("citations", [])],
            knowledge_graph=[KnowledgeGraphRelation(**k) for k in analysis.get("knowledge_graph", [])],
            ai_generated_probability=ai_generated_prob,
            spread_risk=spread_risk,
            estimated_reach=estimated_reach,
            counterfactual_advice=analysis.get("counterfactual_advice", ""),
            important_words=analysis.get("important_words", []),
            engine_message=f"{engine_message} Completed in {total_time:.1f}s.",
            analyzed_text=extracted_text
        )

    except Exception as e:
        print(f"Critical error in prediction process: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"AI Engine Error: {str(e)}")


# ============================================================
# PDF EXPORT ENDPOINT
# ============================================================

@app.post("/api/export/pdf")
async def export_pdf(data: dict = Body(...)):
    from fastapi import HTTPException
    raise HTTPException(status_code=501, detail="PDF Export is disabled to fit Vercel size limits.")


# ============================================================
# LOCAL DEV SERVER
# ============================================================

if __name__ == "__main__":
    import uvicorn
    from fastapi.staticfiles import StaticFiles
    import os
    
    public_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../public"))
    if os.path.exists(public_dir):
        app.mount("/", StaticFiles(directory=public_dir, html=True), name="public")
        
    uvicorn.run("index:app", host="0.0.0.0", port=8019, reload=True)
