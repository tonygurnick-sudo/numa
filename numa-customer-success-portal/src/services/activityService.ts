import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers'
import { getConfigValue } from './configService'
import { authService } from './authService'
import type { ActivityRecord, CreateActivityRequest, ActivityFilter, ActivitySummary } from '@/types/activity'

export class ActivityService {
  private getCredentialsProvider() {
    if (!this.isInBrowser() || !this.hasCognitoConfig()) return undefined

    const region = getConfigValue('AWS_REGION') || 'us-east-1'
    const identityPoolId = getConfigValue('IDENTITY_POOL_ID')!
    const userPoolId = getConfigValue('USER_POOL_ID')!

    return async () => {
      const ensured = await authService.ensureValidSession(60 * 1000)
      const session = ensured || authService.getCurrentSession()
      if (!session) throw new Error('Not authenticated')
      const idToken = session.idToken
      const base = fromCognitoIdentityPool({
        identityPoolId,
        logins: {
          [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken,
        },
        clientConfig: { region },
      })
      return base()
    }
  }

  private isInBrowser(): boolean {
    return typeof window !== 'undefined'
  }

  private hasCognitoConfig(): boolean {
    return !!(getConfigValue('IDENTITY_POOL_ID') && getConfigValue('USER_POOL_ID'))
  }

  private generateActivityId(): string {
    return `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  async logActivity(request: CreateActivityRequest): Promise<void> {
    try {
      const session = authService.getCurrentSession()
      if (!session) {
        console.warn('No active session, skipping activity log')
        return
      }

      const activityTableName = getConfigValue('ACTIVITY_TABLE')
      if (!activityTableName) {
        console.warn('No activity table configured, skipping activity log')
        return
      }

      const credentials = this.getCredentialsProvider()
      if (!credentials) return

      const region = getConfigValue('AWS_REGION') || 'us-east-1'
      const ddb = new DynamoDBClient({ region, credentials })
      const doc = DynamoDBDocumentClient.from(ddb)

      const activity: ActivityRecord = {
        activityId: this.generateActivityId(),
        timestamp: new Date().toISOString(),
        userId: session.user.sub || 'unknown',
        userEmail: session.user.email || 'unknown',
        ...request
      }

      await doc.send(new PutCommand({
        TableName: activityTableName,
        Item: activity
      }))

      console.debug('Activity logged:', activity.type, activity.action, activity.resourceId)
    } catch (error) {
      console.error('Failed to log activity:', error)
      // Don't throw - activity logging shouldn't break the main operation
    }
  }

  async getRecentActivities(filter: ActivityFilter = {}): Promise<ActivityRecord[]> {
    try {
      const activityTableName = getConfigValue('ACTIVITY_TABLE')
      if (!activityTableName) {
        return []
      }

      const credentials = this.getCredentialsProvider()
      if (!credentials) return []

      const region = getConfigValue('AWS_REGION') || 'us-east-1'
      const ddb = new DynamoDBClient({ region, credentials })
      const doc = DynamoDBDocumentClient.from(ddb)

      const limit = filter.limit || 50
      const now = new Date()
      const defaultStartTime = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString() // 30 days ago

      // If filtering by type, use the GSI
      if (filter.type) {
        const result = await doc.send(new QueryCommand({
          TableName: activityTableName,
          IndexName: 'type-timestamp-index',
          KeyConditionExpression: '#type = :type AND #timestamp >= :startTime',
          ExpressionAttributeNames: {
            '#type': 'type',
            '#timestamp': 'timestamp'
          },
          ExpressionAttributeValues: {
            ':type': filter.type,
            ':startTime': filter.startTime || defaultStartTime
          },
          ScanIndexForward: false, // Sort descending by timestamp
          Limit: limit
        }))
        return result.Items as ActivityRecord[] || []
      }

      // For all activities, we'd need to scan since we don't have a GSI for all records
      // For now, let's fetch by type and combine multiple queries
      const types: ActivityRecord['type'][] = ['config', 'user', 'system', 'deployment']
      const allActivities: ActivityRecord[] = []

      for (const type of types) {
        try {
          const result = await doc.send(new QueryCommand({
            TableName: activityTableName,
            IndexName: 'type-timestamp-index',
            KeyConditionExpression: '#type = :type AND #timestamp >= :startTime',
            ExpressionAttributeNames: {
              '#type': 'type',
              '#timestamp': 'timestamp'
            },
            ExpressionAttributeValues: {
              ':type': type,
              ':startTime': filter.startTime || defaultStartTime
            },
            ScanIndexForward: false,
            Limit: Math.ceil(limit / types.length)
          }))
          allActivities.push(...(result.Items as ActivityRecord[] || []))
        } catch (err) {
          console.debug(`No activities found for type ${type}:`, err)
        }
      }

      // Sort by timestamp and limit
      return allActivities
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit)

    } catch (error) {
      console.error('Failed to fetch activities:', error)
      return []
    }
  }

  convertToActivitySummary(activity: ActivityRecord): ActivitySummary {
    const getTitle = () => {
      switch (activity.type) {
        case 'config':
          switch (activity.action) {
            case 'created':
              return `Created client configuration`
            case 'updated':
              return `Updated client configuration`
            case 'deleted':
              return `Deleted client configuration`
            default:
              return `Client configuration ${activity.action}`
          }
        case 'user':
          switch (activity.action) {
            case 'created':
              return `Created user account`
            case 'deleted':
              return `Deleted user account`
            case 'password-reset':
              return `Reset user password`
            default:
              return `User ${activity.action}`
          }
        case 'deployment':
          return `Deployment ${activity.action}`
        case 'system':
          return activity.details.metadata?.title || `System ${activity.action}`
        default:
          return `${activity.resourceType} ${activity.action}`
      }
    }

    const getSubtitle = () => {
      const baseSubtitle = `${activity.resourceId}`

      if (activity.type === 'config' && activity.action === 'updated' && activity.details.changes) {
        const changes = activity.details.changes.slice(0, 2).join(', ')
        const moreCount = activity.details.changes.length - 2
        return `${baseSubtitle} • ${changes}${moreCount > 0 ? ` +${moreCount} more` : ''}`
      }

      return baseSubtitle
    }

    const getStatus = (): ActivitySummary['status'] => {
      if (!activity.success) return 'failed'
      if (activity.type === 'deployment' && activity.action === 'started') return 'running'
      return 'success'
    }

    const getLink = () => {
      if (activity.type === 'deployment' && activity.details.metadata?.deploymentId) {
        return `/deployments/${activity.details.metadata.deploymentId}/logs`
      }
      if (activity.type === 'config') {
        return '/configs'
      }
      return undefined
    }

    return {
      id: activity.activityId,
      type: activity.type,
      title: getTitle(),
      subtitle: getSubtitle(),
      timestamp: activity.timestamp,
      status: getStatus(),
      link: getLink(),
      user: activity.userEmail.split('@')[0]
    }
  }
}

export const activityService = new ActivityService()
