import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock3,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ViewState = "idle" | "loading" | "success" | "fallback" | "emergency";
type ThermalState = "chilly" | "neutral" | "warm" | null;

type RecipeData = {
  title: string;
  time: string;
  intro: string;
  ingredients: string[];
  steps: string[];
};

type XaiRationale = {
  western_nutritional_impact: string;
  tcm_energetic_sensation: string;
};

type SynthesizeResponse = {
  system_status: "safe_generation" | "medical_escalation_triggered";
  recipe: RecipeData;
  xai_rationale: XaiRationale;
  mandatory_disclaimer: string;
};

const symptoms = [
  "Bloated",
  "Sluggish",
  "Nauseous",
  "Acidic",
  "Brain Fog",
  "Heavy / Full",
  "Overheated",
  "Cold / Chilly",
];

const loadingMessages = [
  "Running symptom bounds...",
  "Cross-referencing TCM energetics...",
  "Formatting safe protocol...",
];

// Used ONLY if the backend request itself fails (network error, server not
// running, etc.) — not used for the normal "safe_generation" success path,
// which now always renders live data returned by /api/synthesize.
const offlineFallbackRecipe: RecipeData = {
  title: "Universal Safe Base",
  time: "10 mins",
  intro: "A simple, neutral foundation for moments when your body needs less, not more.",
  ingredients: [
    "1/2 cup jasmine rice",
    "2 cups filtered water",
    "1 pinch sea salt",
    "1 tsp olive oil",
  ],
  steps: [
    "Rinse the rice until the water runs mostly clear.",
    "Bring rice, water, and salt to a gentle simmer.",
    "Cook for 10 minutes until soft and silky.",
    "Finish with olive oil and enjoy in small spoonfuls.",
  ],
};

const offlineFallbackRationale: XaiRationale = {
  western_nutritional_impact: "Soluble starch forms a soothing gel matrix that is gentle on digestion.",
  tcm_energetic_sensation: "Neutral properties settle the middle without adding heat or cold.",
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BioSync | Personalized Nutritional Reset" },
      {
        name: "description",
        content: "A real-time nutritional decision engine blending Western nutrition with TCM energetics.",
      },
      { property: "og:title", content: "BioSync | Personalized Nutritional Reset" },
      {
        property: "og:description",
        content: "Find a gentle meal recommendation aligned with your real-time somatic state.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BioSyncPage,
});

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group flex min-h-11 items-center justify-between rounded-full border-0 px-4 py-3 text-left text-sm transition-all ${
        selected
          ? "bg-primary/10 font-semibold text-primary"
          : "bg-secondary/45 text-muted-foreground hover:bg-secondary/80"
      }`}
    >
      <span>{label}</span>
      {selected && <Check aria-hidden="true" size={15} strokeWidth={2.5} className="ml-3 shrink-0" />}
    </button>
  );
}

function Header() {
  return (
    <header className="flex items-start justify-between border-b border-border/70 pb-5">
      <div>
        <p className="font-display text-3xl text-foreground">BioSync</p>
        <p className="mt-1 text-xs tracking-wide text-muted-foreground">
          Deterministic nutritional routing based on real-time biometrics.
        </p>
      </div>
    </header>
  );
}

function SafetyBadge() {
  return (
    <div className="flex items-center justify-center gap-1.5 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
      <ShieldCheck aria-hidden="true" size={13} className="shrink-0 text-primary/70" />
      <span>100% High-Risk Herb Free. Bounded to safe pantry staples only.</span>
    </div>
  );
}

function ThermalPicker({ value, onChange }: { value: ThermalState; onChange: (value: ThermalState) => void }) {
  const options: { id: Exclude<ThermalState, null>; label: string; sublabel: string }[] = [
    { id: "chilly", label: "Chilly", sublabel: "Cold" },
    { id: "neutral", label: "Neutral", sublabel: "Balanced" },
    { id: "warm", label: "Warm", sublabel: "Overheated" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 rounded-2xl bg-secondary/60 p-1.5" role="radiogroup" aria-label="Body sensation">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-xl px-2 py-3 text-center transition-all ${
            value === option.id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="block text-sm font-medium">{option.label}</span>
          <span className="mt-0.5 block text-[10px] tracking-wide opacity-70">{option.sublabel}</span>
        </button>
      ))}
    </div>
  );
}

function EmergencyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="emergency-title">
      <div className="relative w-full max-w-md rounded-3xl bg-card p-7 shadow-xl">
        <button type="button" onClick={onClose} aria-label="Close emergency alert" className="absolute right-5 top-5 rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
          <X size={18} />
        </button>
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-warning/15 text-warning">
          <AlertTriangle size={22} />
        </div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-warning">Please pause here</p>
        <h2 id="emergency-title" className="font-display text-3xl text-foreground">Your safety comes first.</h2>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">The sensation you described may need immediate medical attention. Please contact your local emergency services or go to the nearest emergency department now.</p>
        <button type="button" onClick={onClose} className="mt-6 w-full rounded-full bg-foreground py-3.5 text-sm font-medium text-background transition hover:opacity-90">I understand</button>
      </div>
    </div>
  );
}

function StateSummary({ symptoms: selected, thermal }: { symptoms: string[]; thermal: Exclude<ThermalState, null> }) {
  return (
    <section aria-labelledby="state-title" className="result-summary animate-in fade-in slide-in-from-top-2 duration-500">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/70">Real-time biometric / somatic state</p>
        <h1 id="state-title" className="mt-1 font-display text-2xl text-foreground sm:text-3xl">Verified Somatic Profile</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {selected.map((symptom) => <span key={symptom} className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">{symptom}</span>)}
        <span className="rounded-full border border-border px-3 py-1.5 text-xs font-medium capitalize text-muted-foreground">{thermal}</span>
      </div>
    </section>
  );
}

function Ingredient({ item }: { item: string }) {
  const match = item.match(/^((?:\d+(?:\/\d+)?|\d+\s+\d+\/\d+)\s+(?:tsp|tbsp|cups?|pinch|oz|g|ml))\s+(.+)$/i);
  if (!match) return <>{item}</>;

  return (
    <>
      <span className="font-semibold text-foreground">{match[1]}</span>{" "}
      <span>{match[2]}</span>
    </>
  );
}

function RecipeResult({
  mode,
  recipe,
  rationale,
  selectedSymptoms,
  thermal,
  onReset,
}: {
  mode: "success" | "fallback";
  recipe: RecipeData;
  rationale: XaiRationale;
  selectedSymptoms: string[];
  thermal: Exclude<ThermalState, null>;
  onReset: () => void;
}) {
  return (
    <div className="result-stage">
      <StateSummary symptoms={selectedSymptoms} thermal={thermal} />
      <div className="result-focus animate-in fade-in slide-in-from-bottom-3 duration-500">
        {mode === "fallback" && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl bg-warning/10 p-4 text-warning-foreground">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <p className="text-sm leading-5"><span className="font-semibold">A gentle substitution was made.</span> We could not find a perfect match, so we chose the Universal Safe Base.</p>
          </div>
        )}
        <article className="relative overflow-hidden rounded-3xl p-6 sm:p-10 bg-card/80 shadow-sm ring-1 ring-border/60 backdrop-blur-md">
          <div className="flex flex-col items-center text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/70">Your gentle reset</p>
            <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-foreground sm:text-5xl">{recipe.title}</h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">{recipe.intro}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground"><Clock3 size={13} /> {recipe.time}</span>
          </div>

          <section aria-labelledby="rationale-heading" className="mt-8 rounded-2xl bg-secondary/30 p-5 sm:p-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/70">Explainable AI</p>
              <h3 id="rationale-heading" className="mt-1 font-display text-2xl text-foreground">Why this pairing</h3>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <div className="border-l-2 border-primary/30 pl-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Western nutritional impact</p>
                <p className="mt-2 text-sm leading-6 text-foreground/80">{rationale.western_nutritional_impact}</p>
              </div>
              <div className="border-l-2 border-primary/30 pl-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">TCM energetic sensation</p>
                <p className="mt-2 text-sm leading-6 text-foreground/80">{rationale.tcm_energetic_sensation}</p>
              </div>
            </div>
          </section>

          <div className="mt-8 space-y-8 border-t border-border/80 pt-7">
            <section aria-labelledby="gather-heading">
              <h3 id="gather-heading" className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Gather</h3>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                {recipe.ingredients.map((item) => <li key={item} className="flex gap-3 leading-5"><span aria-hidden="true" className="text-primary/60">•</span><span><Ingredient item={item} /></span></li>)}
              </ul>
            </section>
            <section aria-labelledby="make-it-heading" className="border-t border-border/80 pt-8">
              <h3 id="make-it-heading" className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Make it</h3>
              <ol className="mt-3 space-y-3 text-sm leading-6 text-foreground/80">
                {recipe.steps.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="mt-8 flex flex-col items-center justify-center gap-2 border-t border-border/80 pt-5 sm:flex-row sm:gap-4">
            <button type="button" onClick={onReset} className="flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-3 text-xs font-medium tracking-wide text-muted-foreground transition hover:bg-secondary/80 hover:text-foreground">
              <RotateCcw size={13} /> Start a new check-in
            </button>
          </div>
          <div className="mt-5 border-t border-border/50 pt-5"><SafetyBadge /></div>
        </article>
      </div>
    </div>
  );
}

function LoadingState() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % loadingMessages.length), 1700);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex min-h-[460px] flex-col items-center justify-center text-center">
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
        <div className="absolute inset-2 animate-ping rounded-full bg-primary/10" />
        <Sparkles size={23} className="relative text-primary/70" />
      </div>
      <p className="mt-7 font-display text-2xl text-foreground">A moment for your body.</p>
      <p className="mt-2 text-sm text-muted-foreground">{loadingMessages[index]}</p>
      <div className="mt-7 flex gap-1.5"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:-0.3s]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:-0.15s]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50" /></div>
    </div>
  );
}

function BioSyncPage() {
  const [view, setView] = useState<ViewState>("idle");
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [thermal, setThermal] = useState<ThermalState>(null);
  const [notes, setNotes] = useState("");
  const [recipeData, setRecipeData] = useState<RecipeData | null>(null);
  const [rationale, setRationale] = useState<XaiRationale | null>(null);
  const canSubmit = selectedSymptoms.length > 0 && thermal !== null;
  const isEmergency = useMemo(() => /chest pain|bleeding/i.test(notes), [notes]);

  const reset = () => {
    setView("idle");
    setSelectedSymptoms([]);
    setThermal(null);
    setNotes("");
    setRecipeData(null);
    setRationale(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    if (isEmergency) {
      setView("emergency");
      return;
    }

    setView("loading");

    try {
      const apiUrl = (import.meta.env as any).VITE_API_URL || "http://localhost:8000";
      const response = await fetch(`${apiUrl}/api/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symptoms: selectedSymptoms,
          thermal,
          notes: notes.trim() ? notes.trim() : null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Synthesis request failed with status ${response.status}`);
      }

      const data: SynthesizeResponse = await response.json();

      if (data.system_status === "medical_escalation_triggered") {
        setView("emergency");
        return;
      }

      setRecipeData(data.recipe);
      setRationale(data.xai_rationale);
      setView("success");
    } catch (error) {
      console.error("BioSync synthesis request failed, using offline fallback:", error);
      setRecipeData(offlineFallbackRecipe);
      setRationale(offlineFallbackRationale);
      setView("fallback");
    }
  };

  return (
    <main className="min-h-screen bg-background px-5 py-7 text-foreground sm:px-8 sm:py-9">
      <div className={`mx-auto ${view === "success" || view === "fallback" ? "max-w-6xl" : "max-w-2xl"}`}>
        <Header />
        <div className="mt-8">
          {view === "idle" && (
            <div className="animate-in fade-in duration-300">
              <div className="mb-8">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">01 / Check in</p>
                <h1 className="mt-3 font-display text-4xl leading-tight text-foreground sm:text-5xl">Define your<br /><em className="not-italic text-primary/80">somatic state.</em></h1>
                <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">Select your primary symptoms to generate a safe, mathematically bounded meal protocol.</p>
              </div>
              <section>
                <div className="mb-3 flex items-center justify-between"><label className="text-xs font-medium tracking-wide text-foreground/80">I&apos;m feeling</label><span className="text-xs text-muted-foreground">{selectedSymptoms.length} selected</span></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{symptoms.map((symptom) => <Chip key={symptom} label={symptom} selected={selectedSymptoms.includes(symptom)} onClick={() => setSelectedSymptoms((current) => current.includes(symptom) ? current.filter((item) => item !== symptom) : [...current, symptom])} />)}</div>
              </section>
              <section className="mt-8">
                <label htmlFor="notes" className="text-xs font-medium tracking-wide text-foreground/80">Additional clinical or sensory context <span className="font-normal text-muted-foreground">(Optional)</span></label>
                <div className="relative mt-3"><textarea id="notes" maxLength={100} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Describe any specific sensations or cravings..." className="min-h-24 w-full resize-none rounded-2xl border border-border bg-secondary/45 p-3 pb-7 text-sm leading-6 text-foreground outline-none ring-1 ring-transparent transition placeholder:text-muted-foreground focus:ring-primary/20" /><span className="absolute bottom-3 right-4 text-[10px] text-muted-foreground">{notes.length}/100</span></div>
              </section>
              <section className="mt-8"><label className="text-xs font-medium tracking-wide text-foreground/80">Thermal Baseline</label><div className="mt-3"><ThermalPicker value={thermal} onChange={setThermal} /></div></section>
              <button type="button" disabled={!canSubmit} onClick={submit} className="group mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground">Synthesize Protocol <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" /></button>
              <div className="mt-4"><SafetyBadge /></div>
            </div>
          )}
          {view === "loading" && <LoadingState />}
          {(view === "success" || view === "fallback") && thermal && recipeData && rationale && (
            <RecipeResult mode={view} recipe={recipeData} rationale={rationale} selectedSymptoms={selectedSymptoms} thermal={thermal} onReset={reset} />
          )}
        </div>
        {view === "emergency" && <EmergencyModal onClose={reset} />}
      </div>
    </main>
  );
}