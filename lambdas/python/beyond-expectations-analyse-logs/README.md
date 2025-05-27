# Beyond Expectations - Analyse Logs Lambda

This AWS Lambda function is the intelligent analysis component in the Beyond Expectations error log processing pipeline. It leverages Amazon Bedrock Claude to analyze error logs, categorize them, assess severity, and determine notification requirements.

## Overview

The Lambda serves as the AI-powered brain of the error processing system, transforming raw error logs into actionable insights through:

1. **AI-Powered Analysis**: Leverages Claude to understand error patterns and context
2. **Error Categorization**: Classifies errors into meaningful categories
3. **Severity Assessment**: Determines high/medium/low severity based on error impact
4. **Notification Triage**: Identifies which errors require client and/or internal notifications
5. **Action Recommendations**: Suggests solutions for addressing identified issues

## Core Functionality

- **Intelligent Pattern Recognition**: Identifies error trends and relationships
- **Severity Prioritization**: Focuses attention on the most critical issues first
- **Contextual Analysis**: Considers client, task, and error message context
- **Business Impact Assessment**: Evaluates potential business impact of errors
- **Action-Oriented Outputs**: Provides clear guidance on next steps for each error
- **Configuration Validation**: Ensures configuration files adhere to the expected schema

## Input

The Lambda expects a JSON event with the S3 path to a chunk of error logs:

```json
{
  "chunkPath": "beyond-expectations/logs_to_analyse/2025-05-19/chunk-0.json"
}
```

Input files contain logs in this structure:
```json
{
  "logs": [
    {
      "Id": 95300601,
      "DateTimeUtc": "2025-05-05T23:21:36.063000",
      "ClientId": 1419,
      "ClientName": "Example Client",
      "ParentClientId": null,
      "ParentClientName": null,
      "TaskId": 961,
      "TaskDescription": "Example Task Description",
      "AdminOnly": false,
      "Message": "Error message details...",
      "occurrences": 7,
      "first_occurrence": "2025-05-05T23:21:36.063000",
      "last_occurrence": "2025-05-06T00:06:48.793000"
    }
  ]
}
```

## Output

The Lambda generates detailed analysis results for each log entry and saves them to S3:

```json
{
  "notifications_required": [
    {
      "error_type": "Connection Error",
      "severity": "High",
      "client_notification": "Yes",
      "internal_notification": "Yes",
      "explanation": "Error explanation...",
      "recommended_action": "Action recommendation...",
      "log_entry": { /* Original log entry data */ }
    }
  ],
  "notifications_not_required": [ /* Similar structure for logs not requiring notification */ ],
  "error_categories": {
    "Connection Error": 5,
    "Data Validation Error": 3
  },
  "all_results": [ /* All analyzed log entries with their results */ ]
}
```

The output file is saved to:
`beyond-expectations/logs_analysed/YYYY-MM-DD/chunk-N.json`

## Key Components

- **Bedrock Integration**: Uses Amazon Bedrock Claude for AI-powered analysis
- **Prompt Engineering**: Employs specialized prompts for effective error analysis
- **Function Calling**: Utilizes structured function calling for consistent output
- **Batch Processing**: Processes logs in optimized batches to handle large volumes efficiently
- **Categorization Logic**: Applies consistent error categorization across logs

## Configuration Management

The Lambda supports customizable behavior through configuration files stored in S3:

### Schema Validation

Configuration files are validated against a JSON schema to ensure they adhere to the expected structure. This validation happens when the configuration is loaded, providing early detection of configuration issues.

The schema is defined in `config_schema.py` and enforces:
- Required notification criteria for both internal and external stakeholders
- Proper structure for log filtering rules
- Type validation for all configuration properties

### Configuration Structure

See `example_config.json` for a complete reference configuration. The configuration supports:

```json
{
  "notificationRequirements": {
    "external": {
      "notifyWhen": ["...criteria for client notifications..."],
      "dontNotifyWhen": ["...criteria to skip client notifications..."]
    },
    "internal": {
      "notifyWhen": ["...criteria for internal team notifications..."],
      "dontNotifyWhen": ["...criteria to skip internal notifications..."]
    }
  },
  "logsToIgnore": {
    "byClientTask": [
      {
        "ClientId": 1234,
        "TaskDescription": "Task to ignore"
      }
    ],
    "byMessageContains": [
      "Text pattern to ignore"
    ]
  }
}
```

## AI Capabilities

The Lambda leverages Claude's capabilities to:
- Identify error patterns not obvious to human reviewers
- Categorize diverse error types into a consistent taxonomy
- Assess business impact based on error context and client information
- Generate clear, actionable recommendations for resolution
- Determine appropriate notification routing based on error characteristics

## Integration

This Lambda is designed as the middle component in the Beyond Expectations error processing pipeline:

1. **Format Error Logs**: Prepares and chunks logs for analysis
2. **Analyse Logs** (this Lambda): Processes each chunk for insights
3. **Report and Email**: Aggregates analyses and sends notifications

## Performance Optimizations

### Multi-level Caching Strategy

This Lambda implements a multi-level caching strategy to improve performance and reduce unnecessary S3 operations:

1. **Analysis Result Caching**: Persists analysis results to S3 with a date-based structure to avoid re-analyzing the same error patterns across days.
   - Each log entry's analysis is checked against the past 30 days of results before being processed.
   - This significantly reduces Bedrock API calls and processing time for recurring errors.

### Configuration Management

#### Schema Validation

The Lambda implements JSON Schema validation for configuration files to ensure:
- All required fields are present
- Field types match expected data types
- Configuration changes don't break functionality

When a config file fails validation:
- A detailed error is logged
- The system falls back to default configuration
- The Lambda continues execution with valid settings

#### Graceful Fallbacks

The system has multi-tiered fallbacks to ensure resiliency:
- Primary: Custom configuration from S3
- Secondary: Default in-code configuration

## Configuration

The Lambda uses a JSON configuration file that can be customized and stored in S3. The path to this file is specified via the `CONFIG_PATH` environment variable.

### Configuration Schema

The configuration follows this structure:

```json
{
  "notificationRequirements": {
    "external": {
      "notifyWhen": ["Conditions when client notification is needed"],
      "dontNotifyWhen": ["Conditions when client notification is not needed"]
    },
    "internal": {
      "notifyWhen": ["Conditions when internal notification is needed"],
      "dontNotifyWhen": ["Conditions when internal notification is not needed"]
    }
  },
  "logsToIgnore": {
    "byClientTask": [
      {
        "ClientId": 123456789,
        "TaskDescription": "Task description to ignore"
      }
    ],
    "byMessageContains": ["Error message pattern to ignore"]
  }
}
```

See `example_config.json` for a complete example configuration.

### Schema Validation

The configuration is validated against a JSON schema defined in `config_schema.py`. If validation fails, the system logs an error and falls back to default configuration.

The analysis results are specifically structured to enable the downstream reporting component to generate comprehensive reports and targeted notifications.
