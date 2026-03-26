import { describe, it, expect } from 'vitest';
import {
  validateCreatePayload,
  validateScheduleRecord,
  CreateSchedulePayloadSchema,
  estimateCronIntervalMinutes,
} from '../../../lib/scheduling-schemas';

describe('Scheduling Schemas', () => {
  describe('CreateSchedulePayload validation', () => {
    it('should validate a correct payload', () => {
      const validPayload = {
        agentId: 'agent-123',
        conversationId: 'conv-456',
        promptText: '',
        cronExpression: 'cron(0 9 ? * MON-FRI *)',
        timezone: 'America/New_York',
        label: 'Daily standup',
      };

      expect(() => validateCreatePayload(validPayload)).not.toThrow();
    });

    it('should reject invalid cron expressions', () => {
      const invalidPayload = {
        agentId: 'agent-123',
        conversationId: 'conv-456',
        promptText: 'Test prompt',
        cronExpression: 'invalid-cron',
        timezone: 'America/New_York',
      };

      expect(() => validateCreatePayload(invalidPayload)).toThrow();
    });

    it('should reject invalid timezones', () => {
      const invalidPayload = {
        agentId: 'agent-123',
        conversationId: 'conv-456',
        promptText: 'Test prompt',
        cronExpression: 'cron(0 9 ? * MON-FRI *)',
        timezone: 'Invalid/Timezone',
      };

      expect(() => validateCreatePayload(invalidPayload)).toThrow();
    });

    it('should reject empty required fields', () => {
      const invalidPayload = {
        agentId: '',
        conversationId: 'conv-456',
        promptText: 'Test prompt',
        cronExpression: 'cron(0 9 ? * MON-FRI *)',
        timezone: 'America/New_York',
      };

      expect(() => validateCreatePayload(invalidPayload)).toThrow();
    });
  });

  describe('ScheduleRecord validation', () => {
    it('should validate a complete schedule record', () => {
      const validRecord = {
        user_id: 'user-123',
        schedule_id: '550e8400-e29b-41d4-a716-446655440000',
        tenant_id: 'numa-client',
        conversation_id: 'conv-456',
        prompt_text: '',
        cron_expression: 'cron(0 9 ? * MON-FRI *)',
        timezone: 'America/New_York',
        status: 'active' as const,
        event_type: 'agent' as const,
        agent_id: 'agent-123',
        created_at: Date.now(),
        updated_at: Date.now(),
        schedule_name: 'numa-client-550e8400-e29b-41d4-a716-446655440000',
      };

      expect(() => validateScheduleRecord(validRecord)).not.toThrow();
    });

    it('should reject invalid UUID format for schedule_id', () => {
      const invalidRecord = {
        user_id: 'user-123',
        schedule_id: 'invalid-uuid',
        tenant_id: 'numa-client',
        conversation_id: 'conv-456',
        prompt_text: 'Test prompt',
        cron_expression: 'cron(0 9 ? * MON-FRI *)',
        timezone: 'America/New_York',
        status: 'active' as const,
        event_type: 'agent' as const,
        agent_id: 'agent-123',
        created_at: Date.now(),
        updated_at: Date.now(),
        schedule_name: 'numa-client-invalid-uuid',
      };

      expect(() => validateScheduleRecord(invalidRecord)).toThrow();
    });
  });

  describe('estimateCronIntervalMinutes', () => {
    it('should estimate minute-step intervals', () => {
      expect(estimateCronIntervalMinutes('cron(0/5 * * * ? *)')).toBe(5);
      expect(estimateCronIntervalMinutes('cron(*/10 * * * ? *)')).toBe(10);
      expect(estimateCronIntervalMinutes('cron(0/30 * * * ? *)')).toBe(30);
    });

    it('should estimate hour-step intervals', () => {
      expect(estimateCronIntervalMinutes('cron(0 */2 * * ? *)')).toBe(120);
      expect(estimateCronIntervalMinutes('cron(0 0/4 * * ? *)')).toBe(240);
      expect(estimateCronIntervalMinutes('cron(30 */1 * * ? *)')).toBe(60);
    });

    it('should estimate day-step intervals', () => {
      expect(estimateCronIntervalMinutes('cron(0 9 1/3 * ? *)')).toBe(4320);
    });

    it('should return 1440 for daily schedules', () => {
      expect(estimateCronIntervalMinutes('cron(0 9 * * ? *)')).toBe(1440);
    });

    it('should return 1440 for weekday schedules', () => {
      expect(estimateCronIntervalMinutes('cron(0 9 ? * MON-FRI *)')).toBe(1440);
    });

    it('should return Infinity for once-off schedules (specific year)', () => {
      expect(estimateCronIntervalMinutes('cron(30 14 15 6 ? 2025)')).toBe(Infinity);
    });

    it('should return large number for monthly schedules', () => {
      expect(estimateCronIntervalMinutes('cron(0 9 15 * ? *)')).toBe(43200);
    });

    it('should return null for invalid input', () => {
      expect(estimateCronIntervalMinutes('not-a-cron')).toBeNull();
      expect(estimateCronIntervalMinutes('cron()')).toBeNull();
    });
  });

  describe('Cron expression validation', () => {
    it('should accept valid AWS EventBridge cron expressions', () => {
      const validExpressions = [
        'cron(0 9 ? * MON-FRI *)',
        'cron(15 10 * * * *)',
        'cron(0 18 ? * MON-FRI *)',
        'cron(0 8 1 * ? *)',
        'cron(0/15 * * * ? *)',
        'cron(0 9 ? JAN MON *)',
        'cron(0 9 L * ? *)',
        'cron(0 9 LW * ? *)',
        'cron(0 9 15W * ? *)',
        'cron(0 9 ? * MON#2 *)',
        'cron(0 9 ? * MONL *)',
      ];

      validExpressions.forEach((expr) => {
        const payload = {
          agentId: 'agent-123',
          conversationId: 'conv-456',
          promptText: '',
          cronExpression: expr,
          timezone: 'UTC',
        };
        expect(() => CreateSchedulePayloadSchema.parse(payload)).not.toThrow();
      });
    });

    it('should reject invalid cron expressions', () => {
      const invalidExpressions = [
        'invalid-cron',
        'cron()',
        'cron(60 25 32 13 8 *)', // Invalid values
        '0 9 * * MON-FRI', // Missing cron() wrapper
        'rate(invalid)',
        'cron(0 9 * * MON-FRI *)', // day-of-month must be ? when day-of-week is specified
        'cron(0 9 1 * MON *)', // day-of-month and day-of-week both specified
        'cron(0 9 ? * ? *)', // both day-of-month and day-of-week are ?
        'cron(0 9 * * MON *)', // day-of-month must be ? when day-of-week is specified
      ];

      invalidExpressions.forEach((expr) => {
        const payload = {
          agentId: 'agent-123',
          conversationId: 'conv-456',
          promptText: '',
          cronExpression: expr,
          timezone: 'UTC',
        };
        expect(() => CreateSchedulePayloadSchema.parse(payload)).toThrow();
      });
    });
  });
});
