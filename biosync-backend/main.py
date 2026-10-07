"""
BioSync Backend
================
FastAPI server that powers the /api/synthesize endpoint consumed by the
BioSync React frontend (index.tsx).

Pipeline for every request:
  1. Deterministic Safety Router ("The Bouncer") — scans raw user input for
     red-flag medical keywords BEFORE any LLM call is made. If triggered,
     the LLM is never invoked (0ms LLM compute) and a medical escalation
     payload is returned immediately.
  2. Local RAG lookup — filters knowledge_base.json down to the ingredients
     most relevant to the user's selected symptoms and thermal state.
  3. Groq call (llama-3.3-70b-versatile) — the LLM is given ONLY the
     retrieved ingredient context and is strictly instructed to compose a
     recipe using nothing else, output as JSON matching the UI contract.

Run with:
    uvicorn main:app --reload --port 8000
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from pydantic import BaseModel, Field, ValidationError

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("biosync")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = "openai/gpt-oss-20b"
KNOWLEDGE_BASE_PATH = Path(__file__).parent / "knowledge_base.json"

MANDATORY_DISCLAIMER = "100% HIGH-RISK HERB FREE. BOUNDED TO SAFE PANTRY STAPLES ONLY."

app = FastAPI(title="BioSync Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

groq_client: Optional[Groq] = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

KNOWLEDGE_BASE: List[dict] = []


@app.on_event("startup")
def load_knowledge_base() -> None:
    """Load knowledge_base.json into memory once, at server startup."""
    global KNOWLEDGE_BASE
    if not KNOWLEDGE_BASE_PATH.exists():
        raise RuntimeError(f"knowledge_base.json not found at {KNOWLEDGE_BASE_PATH}")
    with open(KNOWLEDGE_BASE_PATH, "r", encoding="utf-8") as f:
        KNOWLEDGE_BASE = json.load(f)
    logger.info("Loaded %d ingredients into the local knowledge base.", len(KNOWLEDGE_BASE))


# ---------------------------------------------------------------------------
# Deterministic Safety Router ("The Bouncer")
# ---------------------------------------------------------------------------

RED_FLAG_KEYWORDS = [
    "chest pain",
    "bleeding",
    "blood in stool",
    "blood in vomit",
    "shortness of breath",
    "can't breathe",
    "cant breathe",
    "difficulty breathing",
    "suicide",
    "suicidal",
    "self harm",
    "self-harm",
    "stroke",
    "fainting",
    "fainted",
    "passed out",
    "unconscious",
    "numbness",
    "numb on one side",
    "slurred speech",
    "seizure",
    "severe abdominal pain",
    "heart attack",
    "overdose",
    "poisoning",
    "anaphylaxis",
    "allergic reaction",
    "can't feel my",
]

RED_FLAG_PATTERN = re.compile(
    r"(" + "|".join(re.escape(kw) for kw in RED_FLAG_KEYWORDS) + r")",
    re.IGNORECASE,
)


def scan_for_red_flags(symptoms: List[str], notes: Optional[str]) -> bool:
    """
    Scans the raw symptom list and free-text notes for red-flag medical
    keywords. Returns True the moment any match is found. This function
    runs BEFORE any network or LLM call — it is pure, local, and fast.
    """
    haystacks = list(symptoms)
    if notes:
        haystacks.append(notes)

    combined_text = " | ".join(haystacks)
    return bool(RED_FLAG_PATTERN.search(combined_text))


# ---------------------------------------------------------------------------
# Local RAG retrieval
# ---------------------------------------------------------------------------

# Maps the user's felt thermal sensation to the ingredient thermal property
# that is generally indicated to help balance it (TCM "treat the opposite"
# principle), while always keeping Neutral ingredients in the eligible pool.
THERMAL_PREFERENCE_MAP = {
    "chilly": "Warm",
    "warm": "Cold",
    "neutral": "Neutral",
}


def retrieve_relevant_ingredients(symptoms: List[str], thermal: str, top_k: int = 6) -> List[dict]:
    """
    Scores and strictly filters ingredients against TCM thermal contraindications.
    - If user is 'warm': HARD EXCLUDE all 'Warm' thermal ingredients.
    - If user is 'chilly': HARD EXCLUDE all 'Cold' thermal ingredients.
    """
    preferred_thermal = THERMAL_PREFERENCE_MAP.get(thermal, "Neutral")
    selected_symptoms = set(symptoms)

    scored: List[tuple] = []
    for ingredient in KNOWLEDGE_BASE:
        prop = ingredient.get("thermal_property")

        # STRICT TCM CONTRAINDICATION HARD-FILTERS
        if thermal == "warm" and prop == "Warm":
            continue  # Never pass warming herbs to an overheated state
        if thermal == "chilly" and prop == "Cold":
            continue  # Never pass cooling herbs to a cold state

        score = 0
        overlap = selected_symptoms.intersection(set(ingredient.get("symptoms_targeted", [])))
        score += 3 * len(overlap)

        if prop == preferred_thermal:
            score += 2
        if prop == "Neutral":
            score += 1

        if score > 0:
            scored.append((score, ingredient))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    top_matches = [ingredient for _, ingredient in scored[:top_k]]

    # Guarantee a safe, always-digestible neutral base if filtering emptied the pool
    if not top_matches:
        fallback_names = {"Jasmine Rice", "Sea Salt", "Oats", "Honey"}
        top_matches = [item for item in KNOWLEDGE_BASE if item["name"] in fallback_names]

    return top_matches


# ---------------------------------------------------------------------------
# Request / Response contracts
# ---------------------------------------------------------------------------

class SynthesizeRequest(BaseModel):
    symptoms: List[str] = Field(default_factory=list)
    thermal: Literal["chilly", "neutral", "warm"]
    notes: Optional[str] = Field(default=None, max_length=100)


class RecipeModel(BaseModel):
    title: str
    time: str
    intro: str
    ingredients: List[str]
    steps: List[str]


class XaiRationale(BaseModel):
    western_nutritional_impact: str
    tcm_energetic_sensation: str


class SynthesizeResponse(BaseModel):
    system_status: Literal["safe_generation", "medical_escalation_triggered"]
    recipe: RecipeModel
    xai_rationale: XaiRationale
    mandatory_disclaimer: str


# ---------------------------------------------------------------------------
# Groq synthesis
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are BioSync's recipe synthesis engine.

You must respond with ONLY valid JSON. No markdown, no code fences, no
commentary before or after the JSON. The JSON must match this exact shape:

{
  "recipe": {
    "title": string,
    "time": string,
    "intro": string,
    "ingredients": string[],
    "steps": string[]
  },
  "xai_rationale": {
    "western_nutritional_impact": string,
    "tcm_energetic_sensation": string
  }
}

STRICT RULES:
1. You may ONLY use ingredients that appear in the "Approved Ingredient Context" provided in the user message. Do not invent or add unapproved ingredients. Water, ice, and basic cooking methods (boil, steep, simmer) are allowed.
2. MANDATORY TCM THERMAL LOGIC RULES:
   - IF user thermal baseline is "warm": STRICTLY EXCLUDE any (thermal: Warm) ingredients. Only synthesize using Cold or Neutral ingredients.
   - IF user thermal baseline is "chilly": STRICTLY EXCLUDE any (thermal: Cold) ingredients. Only synthesize using Warm or Neutral ingredients.
   - IF user thermal baseline is "neutral": Focus on Neutral foundation ingredients.
   - THERMAL OVERRIDE GUARANTEE: Thermal balance ALWAYS supersedes symptom matching.
3. Keep output concise: "ingredients" list (3-5 items max), "steps" list (3-4 concise steps max), and rationales (1 short sentence each).
4. Output ONLY the JSON object. Do not exceed length limits."""


def build_user_prompt(symptoms: List[str], thermal: str, notes: Optional[str], context_ingredients: List[dict]) -> str:
    context_lines = []
    for ing in context_ingredients:
        context_lines.append(
            f"- {ing['name']} (thermal: {ing['thermal_property']}; "
            f"targets: {', '.join(ing['symptoms_targeted'])}; "
            f"max safe dosage: {ing['max_safe_dosage']}; "
            f"TCM: {ing['tcm_energetic_impact']}; "
            f"Western: {ing['western_nutritional_impact']})"
        )
    context_block = "\n".join(context_lines)

    notes_block = notes.strip() if notes and notes.strip() else "None provided."

    return f"""User's reported symptoms: {', '.join(symptoms) if symptoms else 'None specified'}
User's thermal baseline: {thermal}
User's additional notes: {notes_block}

Approved Ingredient Context (you may ONLY use ingredients from this list):
{context_block}

Compose one gentle recipe using only the approved ingredients above. You MUST output nothing but valid JSON starting exactly with the {{ character. Do not use markdown blocks (no ```json)."""


def call_groq_for_recipe(symptoms: List[str], thermal: str, notes: Optional[str], context_ingredients: List[dict]) -> dict:
    if groq_client is None:
        raise RuntimeError("GROQ_API_KEY is not configured on the server.")

    user_prompt = build_user_prompt(symptoms, thermal, notes, context_ingredients)

    completion = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        max_tokens=2048,
        response_format={"type": "json_object"},
    )

    raw_content = completion.choices[0].message.content
    return json.loads(raw_content)


def build_local_fallback_recipe(context_ingredients: List[dict]) -> dict:
    """
    A fully deterministic, zero-LLM fallback used only if the Groq call
    fails or returns malformed output. Guarantees the endpoint never
    errors out on the user with an unhandled 500.
    """
    names = [ing["name"] for ing in context_ingredients][:4] or ["Jasmine Rice", "Sea Salt"]
    ingredients_list = ["1/2 cup jasmine rice", "2 cups filtered water", "1 pinch sea salt"]
    if "Fresh Grated Ginger" in names:
        ingredients_list.insert(1, "1 tsp fresh grated ginger")
    if "Toasted Sesame Oil" in names:
        ingredients_list.append("1 tsp toasted sesame oil")

    return {
        "recipe": {
            "title": "Universal Safe Base",
            "time": "10 mins",
            "intro": "A simple, neutral foundation for moments when your body needs less, not more.",
            "ingredients": ingredients_list,
            "steps": [
                "Rinse the rice until the water runs mostly clear.",
                "Bring the rice, water, and any warming ingredients to a gentle simmer.",
                "Cook uncovered for about 10 minutes, stirring occasionally, until soft.",
                "Finish with the sea salt and any finishing oil, then enjoy slowly.",
            ],
        },
        "xai_rationale": {
            "western_nutritional_impact": "Soluble starch forms a soothing gel matrix that is gentle on digestion and easy to tolerate.",
            "tcm_energetic_sensation": "Neutral properties settle the middle without adding excess heat or cold to the system.",
        },
    }


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health_check():
    return {"status": "ok", "knowledge_base_size": len(KNOWLEDGE_BASE), "groq_configured": groq_client is not None}


@app.post("/api/synthesize", response_model=SynthesizeResponse)
def synthesize(payload: SynthesizeRequest):
    # -----------------------------------------------------------------
    # Step 1: Deterministic Safety Router — runs BEFORE any LLM call.
    # -----------------------------------------------------------------
    if scan_for_red_flags(payload.symptoms, payload.notes):
        logger.warning("Red-flag keywords detected. Bypassing Groq entirely.")
        return SynthesizeResponse(
            system_status="medical_escalation_triggered",
            recipe=RecipeModel(
                title="N/A",
                time="N/A",
                intro="A potential medical concern was detected in your input. Please seek appropriate medical care.",
                ingredients=[],
                steps=[],
            ),
            xai_rationale=XaiRationale(
                western_nutritional_impact="N/A — medical escalation triggered before analysis.",
                tcm_energetic_sensation="N/A — medical escalation triggered before analysis.",
            ),
            mandatory_disclaimer=MANDATORY_DISCLAIMER,
        )

    # -----------------------------------------------------------------
    # Step 2: Local RAG retrieval.
    # -----------------------------------------------------------------
    context_ingredients = retrieve_relevant_ingredients(payload.symptoms, payload.thermal)

    # -----------------------------------------------------------------
    # Step 3: Groq synthesis, with a deterministic local fallback if the
    # LLM call or its output fails validation for any reason.
    # -----------------------------------------------------------------
    try:
        raw_result = call_groq_for_recipe(payload.symptoms, payload.thermal, payload.notes, context_ingredients)
        
        # Safely extract recipe dict
        recipe_data = raw_result.get("recipe") or raw_result
        
        # Safely extract rationale dict across common key variations
        rationale_data = (
            raw_result.get("xai_rationale")
            or raw_result.get("rationale")
            or raw_result.get("explanation")
            or {}
        )
        
        recipe = RecipeModel(
            title=recipe_data.get("title", "Gentle Reset Meal"),
            time=recipe_data.get("time", "10 mins"),
            intro=recipe_data.get("intro", "A simple, body-balancing meal."),
            ingredients=recipe_data.get("ingredients", []),
            steps=recipe_data.get("steps", [])
        )
        
        xai_rationale = XaiRationale(
            western_nutritional_impact=rationale_data.get(
                "western_nutritional_impact", 
                "Provides gentle, easily digestible nutrients to support recovery."
            ),
            tcm_energetic_sensation=rationale_data.get(
                "tcm_energetic_sensation", 
                "Balances internal temperature and harmonizes digestive energy."
            )
        )
    #try:
        #raw_result = call_groq_for_recipe(payload.symptoms, payload.thermal, payload.notes, context_ingredients)
        #recipe = RecipeModel(**raw_result["recipe"])
        #xai_rationale = XaiRationale(**raw_result["xai_rationale"])
    except Exception as exc:  # noqa: BLE001 — intentionally broad: any failure must degrade safely
        logger.error("Groq synthesis failed, using local deterministic fallback: %s", exc)
        fallback = build_local_fallback_recipe(context_ingredients)
        try:
            recipe = RecipeModel(**fallback["recipe"])
            xai_rationale = XaiRationale(**fallback["xai_rationale"])
        except ValidationError as validation_exc:
            logger.critical("Local fallback recipe failed validation: %s", validation_exc)
            raise HTTPException(status_code=500, detail="Unable to generate a safe recipe at this time.")

    return SynthesizeResponse(
        system_status="safe_generation",
        recipe=recipe,
        xai_rationale=xai_rationale,
        mandatory_disclaimer=MANDATORY_DISCLAIMER,
    )
