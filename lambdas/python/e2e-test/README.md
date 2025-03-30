# E2E Test Lambda

This Lambda function is designed for end-to-end testing of the job creation and polling functionality.
It simply waits for 30 seconds before completing successfully.

## Functionality

- Receives a job ID in the event
- Logs the start of processing
- Waits for 30 seconds
- Returns a success response with the job ID

## Usage

This Lambda is triggered by the E2E Test App's step function and doesn't need to be invoked directly.
