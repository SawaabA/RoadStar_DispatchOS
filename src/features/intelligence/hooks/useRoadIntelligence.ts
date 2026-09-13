import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DispatchState } from "../../dispatch/types";
import { buildBackhaulSuggestions, buildReplanImpacts, deriveExceptions } from "../lib/intelligence";
import { createInjectedClosure, fetchTrafficIncidents, type TrafficResult } from "../lib/trafficProvider";
import type { OperationalException } from "../types";

const NO_EXCEPTIONS: OperationalException[] = [];

const emptyResult: TrafficResult = {
  incidents: [],
  source: "demo",
  fetchedAt: "",
  message: "Traffic has not loaded yet.",
};

// extraExceptions lets other features, such as load documents, join the same
// inbox without the traffic and dispatch rules knowing about them.
export function useRoadIntelligence(state: DispatchState, extraExceptions: OperationalException[] = NO_EXCEPTIONS) {
  const [traffic, setTraffic] = useState<TrafficResult>(emptyResult);
  const [injected, setInjected] = useState<TrafficResult["incidents"]>([]);
  const [loading, setLoading] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  const [construction, setConstruction] = useState<TrafficResult["incidents"]>([]);

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    setLoading(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    const result = await fetchTrafficIncidents(controller.signal);
    window.clearTimeout(timer);
    if (controllerRef.current !== controller) return;
    setTraffic(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    return () => { window.clearInterval(timer); controllerRef.current?.abort(); controllerRef.current = null; };
  }, [refresh]);

  const injectClosure = useCallback(() => {
    setInjected((current) => [createInjectedClosure(), ...current]);
  }, []);

  return useMemo(() => {
    const effectiveTraffic: TrafficResult = injected.length ? {
      ...traffic,
      incidents: [...injected, ...traffic.incidents, ...construction],
      source: "demo",
      fetchedAt: new Date().toISOString(),
      message: "Demo closure is active alongside the current traffic feed.",
    } : { ...traffic, incidents: [...traffic.incidents, ...construction] };
    return {
    traffic: effectiveTraffic,
    loading,
    refresh,
    injectClosure,
    setConstruction,
    impacts: buildReplanImpacts(state, effectiveTraffic.incidents),
    exceptions: [...deriveExceptions(state, effectiveTraffic.incidents), ...extraExceptions],
    backhauls: buildBackhaulSuggestions(state),
  }}, [state, traffic, construction, injected, loading, refresh, injectClosure, extraExceptions]);
}
