# Restart Crawler Lambda

This Lambda function is responsible for restarting the web crawler Step Function when
approaching the 25,000 event history limit.

## Function

The Lambda receives the current state from the Step Function and:

1. Extracts necessary state information
2. Sets the `continue` flag to true
3. Starts a new execution of the same Step Function
4. Returns information about the new execution

This allows for continuous crawling of large websites without hitting AWS Step Functions' event history limit.

## Development

Run the following commands to set up and test:

```bash
# Install dependencies
poetry install

# Run tests
poetry run pytest
```
