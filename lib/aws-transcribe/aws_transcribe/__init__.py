import json
import os
import time
from dataclasses import dataclass
from typing import Optional

import boto3
import structlog
from botocore.exceptions import ClientError

logger = structlog.get_logger(__name__)
s3_client = boto3.client("s3")


class TranscriptionError(Exception):
    pass


@dataclass
class TranscriptionResponse:
    text: str
    metadata: dict


class AWSTranscribe:
    def __init__(self):
        self.transcribe_client = boto3.client("transcribe")

    def __start_transcription_job(
        self,
        job_name: str,
        media_uri: str,
        language_code: str = "en-US",
        output_bucket: Optional[str] = None,
        output_key: Optional[str] = None,
    ) -> None:
        try:
            logger.info(f"Starting transcription job: {job_name}")

            params = {
                "TranscriptionJobName": job_name,
                "Media": {"MediaFileUri": media_uri},
                "LanguageCode": language_code,
                "OutputBucketName": output_bucket,
                "OutputKey": output_key or "transcripts/",
            }

            self.transcribe_client.start_transcription_job(**params)
        except ClientError as e:
            logger.exception("Failed to start transcription job")
            raise TranscriptionError("Failed to start transcription") from e

    def __wait_for_completion(self, job_name: str, timeout: int = 900) -> dict:
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                result = self.transcribe_client.get_transcription_job(
                    TranscriptionJobName=job_name
                )
                status = result["TranscriptionJob"]["TranscriptionJobStatus"]

                if status == "COMPLETED":
                    logger.info(f"Transcription job completed: {job_name}")
                    return result["TranscriptionJob"]
                elif status == "FAILED":
                    reason = result["TranscriptionJob"].get(
                        "FailureReason", "Unknown reason"
                    )
                    logger.error(f"Transcription job failed: {reason}")
                    raise TranscriptionError(f"Transcription failed: {reason}")

                time.sleep(30)
            except ClientError as e:
                logger.exception("Failed to get transcription job status")
                raise TranscriptionError("Failed to get job status") from e

        raise TranscriptionError("Transcription timed out")

    def __get_transcript(self, job_info: dict) -> str:
        """
        Gets the transcript from S3 using the job info.
        """
        bucket = job_info["OutputBucketName"]
        key = job_info["OutputKey"]

        try:
            logger.info(f"Getting transcript from bucket: {bucket}, key: {key}")

            response = s3_client.get_object(Bucket=bucket, Key=key)
            transcript_json = json.loads(response["Body"].read().decode("utf-8"))
            return transcript_json["results"]["transcripts"][0]["transcript"]
        except Exception as e:
            logger.exception(
                "Failed to get transcript",
                bucket=bucket,
                key=key,
            )
            raise TranscriptionError("Failed to get transcript") from e

    def transcribe(
        self,
        bucket: str,
        key: str,
        job_name: str | None = None,
        language_code: str = "en-US",
        output_bucket: Optional[str] = None,
        output_key: Optional[str] = None,
        name_for_logging: str = "",
    ) -> TranscriptionResponse:
        """
        Transcribe an audio file from S3 and return the transcribed text.
        """
        if name_for_logging:
            logger.info(f"Starting transcription for {name_for_logging}")

        media_uri = f"s3://{bucket}/{key}"
        job_name = job_name or f"transcription-{int(time.time())}"

        output_bucket = output_bucket or bucket
        output_key = output_key or f"transcripts/{job_name}.json"

        self.__start_transcription_job(
            job_name=job_name,
            media_uri=media_uri,
            language_code=language_code,
            output_bucket=output_bucket,
            output_key=output_key,
        )

        job_info = self.__wait_for_completion(job_name)
        logger.info("Job completed, getting transcript")

        job_info["OutputBucketName"] = output_bucket
        job_info["OutputKey"] = output_key

        transcript_data = self.__get_transcript(job_info)

        metadata = {
            "job_name": job_name,
            "duration": job_info.get("MediaLengthSeconds", 0),
            "file_format": job_info.get("MediaFormat"),
            "sample_rate": job_info.get("MediaSampleRateHertz"),
            "language_code": job_info.get("LanguageCode"),
            "output_location": f"s3://{output_bucket}/{output_key}",
        }

        if name_for_logging:
            logger.info(f"Completed transcription for {name_for_logging}", **metadata)

        return TranscriptionResponse(transcript_data, metadata)
