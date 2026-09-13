import { useRef, useState } from "react";
import { AlertTriangle, ShieldCheck, Sparkles } from "lucide-react";
import { AiRequestError, postAi } from "../../../shared/lib/aiClient";
import { buildCopilotRequest, COPILOT_QUESTIONS, type CopilotQuestionId, type CopilotRef, type CopilotRequest } from "../lib/copilotContext";
import type { useRoadIntelligence } from "../hooks/useRoadIntelligence";
import type { ReturnTypeOfDispatchOperations } from "../viewTypes";

type CopilotResponse = {
  answer: string | null;
  citations: CopilotRef[];
  modelUsed: string | null;
  grounded: boolean;
  fallback: boolean;
  reason?: string;
};

type PanelState =
  | { status: "idle" }
  | { status: "loading"; questionId: CopilotQuestionId; request: CopilotRequest }
  | { status: "answered"; questionId: CopilotQuestionId; request: CopilotRequest; result: CopilotResponse }
  | { status: "fallback"; questionId: CopilotQuestionId; request: CopilotRequest; note: string };

const FALLBACK_NOTES: Record<string, string> = {
  unauthenticated: "Sign in to get a narrated answer. These are the facts RoadStar computed.",
  forbidden: "Your role cannot use the copilot. These are the facts RoadStar computed.",
  rate_limited: "Too many questions in the last minute. These are the facts RoadStar computed.",
};
const UNAVAILABLE_NOTE = "The copilot is unavailable right now. These are the facts RoadStar computed, without narration.";

export function CopilotPanel({ ops, intelligence }: { ops: ReturnTypeOfDispatchOperations; intelligence: ReturnType<typeof useRoadIntelligence> }) {
  const [panel, setPanel] = useState<PanelState>({ status: "idle" });
  const latest = useRef(0);

  const ask = async (questionId: CopilotQuestionId) => {
    const request = buildCopilotRequest(questionId, ops.state, intelligence);
    const attempt = ++latest.current;
    if (!ops.userEmail) {
      setPanel({ status: "fallback", questionId, request, note: FALLBACK_NOTES.unauthenticated! });
      return;
    }
    setPanel({ status: "loading", questionId, request });
    try {
      const result = await postAi<CopilotResponse>("/api/ai/copilot", request);
      if (attempt !== latest.current) return;
      setPanel(result.fallback || !result.answer
        ? { status: "fallback", questionId, request, note: UNAVAILABLE_NOTE }
        : { status: "answered", questionId, request, result });
    } catch (error) {
      if (attempt !== latest.current) return;
      const code = error instanceof AiRequestError ? error.code ?? "" : "";
      setPanel({ status: "fallback", questionId, request, note: FALLBACK_NOTES[code] ?? UNAVAILABLE_NOTE });
    }
  };

  const label = (ref: CopilotRef) => {
    if (ref.type === "load") return ops.state.loads.find((item) => item.id === ref.id)?.billNumber ?? ref.id;
    if (ref.type === "driver") return ops.state.drivers.find((item) => item.id === ref.id)?.name ?? ref.id;
    const truck = ops.state.trucks.find((item) => item.id === ref.id);
    return truck ? `Truck ${truck.number}` : ref.id;
  };

  const active = panel.status === "idle" ? null : panel.questionId;

  return <section className="surface copilot-panel" aria-labelledby="copilot-heading">
    <div className="section-head">
      <div><p className="kicker">DISPATCHER COPILOT</p><h2 id="copilot-heading">Ask about today&apos;s operation</h2></div>
      <small className="copilot-provider"><ShieldCheck />SPUR Compute · Canadian-hosted models</small>
    </div>
    <div className="copilot-chips" role="group" aria-label="Suggested questions">
      {COPILOT_QUESTIONS.map((question) => <button
        key={question.id}
        type="button"
        className={`chip${active === question.id ? " active" : ""}`}
        aria-pressed={active === question.id}
        disabled={panel.status === "loading"}
        onClick={() => void ask(question.id)}
      >{question.label}</button>)}
    </div>
    <div className="copilot-result" aria-live="polite">
      {panel.status === "idle" && <p className="copilot-hint">Pick a question. Answers come only from RoadStar&apos;s exceptions, optimizer and detention records, and never change dispatch state.</p>}
      {panel.status === "loading" && <p className="copilot-hint"><Sparkles />Reading RoadStar&apos;s computed facts…</p>}
      {panel.status === "answered" && <>
        <p className="copilot-answer">{panel.result.answer}</p>
        {panel.result.citations.length > 0 && <ul className="copilot-citations" aria-label="Referenced records">
          {panel.result.citations.map((citation) => <li key={`${citation.type}:${citation.id}`} className="badge blue">{label(citation)}</li>)}
        </ul>}
        {!panel.result.grounded && <p className="copilot-warning" role="note"><AlertTriangle />Part of this answer could not be matched to RoadStar data. Check it against the facts below.</p>}
      </>}
      {panel.status === "fallback" && <p className="copilot-note" role="note">{panel.note}</p>}
      {(panel.status === "answered" || panel.status === "fallback") && <FactList request={panel.request} expanded={panel.status === "fallback"} />}
    </div>
  </section>;
}

function FactList({ request, expanded }: { request: CopilotRequest; expanded: boolean }) {
  const body = <>
    <p className="copilot-summary">{request.facts.summary}</p>
    {request.facts.items.length > 0 && <ul className="copilot-facts">
      {request.facts.items.map((item, index) => <li key={index}><b>{item.title}</b><span>{item.detail}</span></li>)}
    </ul>}
  </>;
  return expanded
    ? <div className="copilot-fact-block">{body}</div>
    : <details className="copilot-fact-block"><summary>Show the facts behind this answer</summary>{body}</details>;
}
