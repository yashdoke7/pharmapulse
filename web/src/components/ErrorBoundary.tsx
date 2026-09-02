import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="mx-auto my-8 max-w-2xl border-t-2 border-signal-red bg-signal-red/[0.04] pad">
          <div className="eyebrow text-signal-red">Something went wrong</div>
          <p className="mt-2 text-sm text-ink-soft">
            {error.message || "An unexpected error occurred while rendering this view."}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" onClick={this.handleReload} className="btn-primary">
              Reload page
            </button>
            <button type="button" onClick={this.handleReset} className="btn-ghost">
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
