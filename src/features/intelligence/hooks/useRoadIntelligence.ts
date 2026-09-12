import { useCallback, useEffect, useMemo, useState } from "react";
import type { DispatchState } from "../../dispatch/types";
import { buildBackhaulSuggestions, buildReplanImpacts, deriveExceptions } from "../lib/intelligence";
import { createInjectedClosure, fetchTrafficIncidents, type TrafficResult } from "../lib/trafficProvider";

const emptyResult: TrafficResult = {
  incidents: [],
  source: "demo",
  fetchedAt: "",
  message: "Traffic has not loaded yet.",
};

export function useRoadIntelligence(state: DispatchState) {
  const [traffic, setTraffic] = useState<TrafficResult>(emptyResult);
  const [injected, setInjected] = useState<TrafficResult["incidents"]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    const result = await fetchTrafficIncidents(controller.signal);
    window.clearTimeout(timer);
    setTraffic(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const injectClosure = useCallback(() => {
    setInjected((current) => [createInjectedClosure(), ...current]);
  }, []);

  return useMemo(() => {
    const effectiveTraffic: TrafficResult = injected.length ? {
      ...traffic,
      incidents: [...injected, ...traffic.incidents],
      source: "demo",
      fetchedAt: new Date().toISOString(),
      message: "Demo closure is active alongside the current traffic feed.",
    } : traffic;
    return {
    traffic: effectiveTraffic,
    loading,
    refresh,
    injectClosure,
    impacts: buildReplanImpacts(state, effectiveTraffic.incidents),
    exceptions: deriveExceptions(state, effectiveTraffic.incidents),
    backhauls: buildBackhaulSuggestions(state),
  }}, [state, traffic, injected, loading, refresh, injectClosure]);
}
