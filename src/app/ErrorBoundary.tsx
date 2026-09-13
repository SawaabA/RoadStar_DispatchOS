import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { failed: boolean; reference: string };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, reference: "" };

  static getDerivedStateFromError(): State {
    return { failed: true, reference: crypto.randomUUID() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("RoadStar interface failure", {
      reference: this.state.reference,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error">
        <p>ROADSTAR DISPATCHOS</p>
        <h1>The workspace could not finish loading.</h1>
        <span>Your operational data was not cleared. Reload the page and, if the problem continues, give support reference <b>{this.state.reference}</b>.</span>
        <button onClick={() => window.location.reload()}>Reload workspace</button>
      </main>
    );
  }
}
