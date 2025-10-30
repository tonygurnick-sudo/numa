export interface ActivityRecord {
  activityId: string        // Primary key (UUID)
  timestamp: string         // Sort key (ISO timestamp)
  type: 'config' | 'user' | 'system' | 'deployment'
  action: string           // 'created', 'updated', 'deleted', 'deployed'
  resourceType: string     // 'client-config', 'user', 'deployment'
  resourceId: string       // Client name, user ID, deployment ID
  userId: string           // Who performed the action
  userEmail: string        // Full email for display
  details: {               // Action-specific details
    before?: any
    after?: any
    changes?: string[]
    metadata?: any
  }
  success: boolean         // Whether action succeeded
  errorMessage?: string    // If action failed
}

export interface ActivitySummary {
  id: string
  type: 'config' | 'user' | 'system' | 'deployment'
  title: string
  subtitle: string
  timestamp: string
  status?: 'success' | 'running' | 'failed' | 'warning'
  link?: string
  user?: string
}

export type ActivityFilter = {
  type?: ActivityRecord['type']
  resourceType?: string
  resourceId?: string
  userId?: string
  success?: boolean
  limit?: number
  startTime?: string
  endTime?: string
}

export interface CreateActivityRequest {
  type: ActivityRecord['type']
  action: string
  resourceType: string
  resourceId: string
  details: ActivityRecord['details']
  success: boolean
  errorMessage?: string
}
