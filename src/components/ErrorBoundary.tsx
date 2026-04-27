import { Component, ErrorInfo, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full p-6 text-[#c9d1d9] bg-[#0d1117]">
          <h2 className="text-lg font-semibold text-[#f85149] mb-3">Something went wrong</h2>
          <pre className="text-xs whitespace-pre-wrap max-w-2xl text-[#8b949e] mb-4">
            {this.state.error.message}
          </pre>
          <button
            className="px-4 py-2 rounded bg-[#238636] text-white text-sm font-medium"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
