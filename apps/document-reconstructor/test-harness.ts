// Import your Lambda function
import { handler } from './index'; // Adjust the path to your Lambda function file if needed

// Simulate the event data that your Lambda function expects
const event = {
  s3Key: 'testPDF.pdf' // Replace with a valid S3 key for testing
};

// Invoke the Lambda function directly
handler(event, {})
  .then((result) => {
    console.log('Lambda executed successfully:', result);

    // Check if the HTML is present in the body
    if (result && result.body && result.body.includes('<html>')) {
      console.log('HTML content detected in the response body.');
    } else {
      console.log('HTML content not detected in the response body.');
    }
  })
  .catch((error) => {
    console.error('Lambda execution failed:', error);
  });


//   payload = {
//     "s3Key": file_name_here,
//   }

//   response = client.invoke(
//     FunctionName='document-reconstructor',
//     InvocationType='RequestResponse',
//     Payload=json.dumps(payload),
// )
