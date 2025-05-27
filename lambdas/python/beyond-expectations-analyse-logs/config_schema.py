"""
JSON Schema for Beyond Expectations configuration validation.
"""

CONFIG_SCHEMA = {
    "type": "object",
    "properties": {
        "notificationRequirements": {
            "type": "object",
            "properties": {
                "external": {
                    "type": "object",
                    "properties": {
                        "notifyWhen": {"type": "array", "items": {"type": "string"}},
                        "dontNotifyWhen": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["notifyWhen", "dontNotifyWhen"],
                },
                "internal": {
                    "type": "object",
                    "properties": {
                        "notifyWhen": {"type": "array", "items": {"type": "string"}},
                        "dontNotifyWhen": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["notifyWhen", "dontNotifyWhen"],
                },
            },
            "required": ["external", "internal"],
        },
        "logsToIgnore": {
            "type": "object",
            "properties": {
                "byClientTask": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "ClientId": {"type": ["string", "number"]},
                            "TaskDescription": {"type": "string"},
                        },
                        "required": ["ClientId", "TaskDescription"],
                    },
                },
                "byMessageContains": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["byClientTask", "byMessageContains"],
        },
    },
    "required": ["notificationRequirements", "logsToIgnore"],
}
