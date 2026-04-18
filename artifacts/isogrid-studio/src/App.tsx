import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Studio from "@/pages/Studio";

const queryClient = new QueryClient();

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(err: Error) { return { error: err.message }; }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error(err, info); }
  render() {
    if (this.state.error) return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0e0d0c", color: "#e8a030", fontFamily: "monospace", textAlign: "center" }}>
        <div>
          <div style={{ fontSize: 28 }}>⬡</div>
          <div style={{ fontWeight: 700, letterSpacing: 2, marginBottom: 8, marginTop: 12 }}>GRIDER BY NITESH HSETIN</div>
          <div style={{ fontSize: 12, opacity: .6, maxWidth: 320 }}>{this.state.error}</div>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "8px 20px", background: "#e8a030", color: "#0e0d0c", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 700 }}>Reload</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Studio} />
      <Route path="*" component={Studio} />
    </Switch>
  );
}

function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default App;
