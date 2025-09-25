import { useState, useCallback, useRef } from 'react'
import type {
  ToolExecution,
  ToolExecutionStatus,
  ToolProgress,
  ToolResult
} from '@/types/tools'

interface UseToolExecutionOptions {
  onCompleted?: (result: ToolResult) => void
  onFailed?: (error: string) => void
  onCancelled?: () => void
}

interface UseToolExecutionReturn {
  execution: ToolExecution | null
  isRunning: boolean
  execute: (toolId: string, parameters: Record<string, unknown>, executor: ToolExecutor) => Promise<void>
  cancel: () => void
  reset: () => void
}

type ToolExecutor = (
  parameters: Record<string, unknown>,
  onProgress: (progress: ToolProgress) => void,
  signal: AbortSignal
) => Promise<ToolResult>

export function useToolExecution({
  onCompleted,
  onFailed,
  onCancelled,
}: UseToolExecutionOptions = {}): UseToolExecutionReturn {
  const [execution, setExecution] = useState<ToolExecution | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const updateExecution = useCallback((updates: Partial<ToolExecution>) => {
    setExecution(prev => prev ? { ...prev, ...updates } : null)
  }, [])

  const updateProgress = useCallback((progress: ToolProgress) => {
    updateExecution({ progress })
  }, [updateExecution])

  const updateStatus = useCallback((status: ToolExecutionStatus, additionalUpdates?: Partial<ToolExecution>) => {
    const updates: Partial<ToolExecution> = { status, ...additionalUpdates }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.completedAt = new Date()
    }

    updateExecution(updates)
  }, [updateExecution])

  const execute = useCallback(async (
    toolId: string,
    parameters: Record<string, unknown>,
    executor: ToolExecutor
  ) => {
    // Cancel any existing execution
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // Create new execution
    const newExecution: ToolExecution = {
      id: `execution-${Date.now()}`,
      toolId,
      status: 'running',
      startedAt: new Date(),
      parameters,
      progress: { current: 0, total: 100, message: 'Initializing...' },
    }

    setExecution(newExecution)

    try {
      const result = await executor(parameters, updateProgress, abortController.signal)

      // Check if execution was cancelled during execution
      if (abortController.signal.aborted) {
        updateStatus('cancelled')
        onCancelled?.()
        return
      }

      updateStatus('completed', { result })
      onCompleted?.(result)

    } catch (error) {
      // Check if error is due to cancellation
      if (abortController.signal.aborted) {
        updateStatus('cancelled')
        onCancelled?.()
        return
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      updateStatus('failed', { error: errorMessage })
      onFailed?.(errorMessage)
    }
  }, [updateProgress, updateStatus, onCompleted, onFailed, onCancelled])

  const cancel = useCallback(() => {
    if (abortControllerRef.current && execution?.status === 'running') {
      abortControllerRef.current.abort()
      updateStatus('cancelled')
      onCancelled?.()
    }
  }, [execution?.status, updateStatus, onCancelled])

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setExecution(null)
  }, [])

  return {
    execution,
    isRunning: execution?.status === 'running',
    execute,
    cancel,
    reset,
  }
}
