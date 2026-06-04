import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Log to console so devtools/test harnesses can capture the stack
    // and so the user can paste the trace after reproducing the issue.
    // Do not attempt network reporting here.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught error:', error, info)
    this.setState({ info })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 max-w-3xl mx-auto">
          <div className="card text-left p-4 bg-red-950/10 border border-red-900/30">
            <div className="text-red-300 font-semibold">A component error occurred</div>
            <div className="text-xs text-gray-400 mt-2">The UI encountered an error while rendering this view. Open developer tools and check the console for the full stack trace.</div>
            <details className="mt-3 text-xs text-gray-300"><summary className="cursor-pointer">Error details</summary>
              <pre className="mt-2 text-xs font-mono text-red-200 break-words">{String(this.state.error)}</pre>
            </details>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
