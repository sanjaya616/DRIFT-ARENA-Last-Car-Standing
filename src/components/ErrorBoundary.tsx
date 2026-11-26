import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Drift Arena ErrorBoundary caught:', error, info);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 p-6 text-slate-100">
          <div className="max-w-md rounded-xl border border-rose-500/50 bg-slate-900 p-6 shadow-2xl">
            <h1 className="text-lg font-black tracking-wide text-rose-400 uppercase">
              Session Interrupted
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="mt-4 rounded-lg bg-orange-500 px-4 py-2 text-xs font-black tracking-wider text-slate-950 uppercase hover:bg-orange-400"
            >
              Return to Arena
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
