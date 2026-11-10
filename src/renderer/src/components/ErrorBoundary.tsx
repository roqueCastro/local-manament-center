import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="p-4 text-xs font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap">
          <strong>Error en la interfaz</strong>
          {'\n\n'}
          {this.state.error.message}
          {'\n\n'}
          {this.state.error.stack}
        </div>
      )
    }
    return this.props.children
  }
}
