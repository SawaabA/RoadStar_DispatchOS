import { runConstrainedReplay } from "./replay";
self.onmessage = (event: MessageEvent) => {
  try { self.postMessage({ result: runConstrainedReplay(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Replay failed." }); }
};
