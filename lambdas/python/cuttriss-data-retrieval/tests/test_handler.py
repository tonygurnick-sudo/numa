import io

import lambda_function as lf


class DummySecrets:
    def get_secret_value(self, SecretId):
        return {"SecretString": "FAKEPAT"}


class DummyS3:
    def __init__(self):
        self.storage = {}

    def head_object(self, **kwargs):
        raise lf.botocore.exceptions.ClientError(
            {"Error": {"Code": "NoSuchKey", "Message": "missing"}},
            "HeadObject",
        )

    def upload_fileobj(self, *a, **k):
        pass

    def get_object(self, Bucket, Key):
        if Key not in self.storage:
            raise lf.botocore.exceptions.ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "missing"}},
                "GetObject",
            )
        return {"Body": io.BytesIO(self.storage[Key])}

    def put_object(self, Bucket, Key, Body, **kwargs):
        data = Body if isinstance(Body, (bytes, bytearray)) else Body.encode("utf-8")
        self.storage[Key] = bytes(data)

    def delete_object(self, Bucket, Key):
        self.storage.pop(Key, None)


class DummyResp:
    status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        # Return empty structure for items & files endpoints
        return {"SubFolders": []}


class DummyRespFiles(DummyResp):
    def json(self):
        return {"Result": []}


class DummySession:
    def get(self, url, *a, **k):
        if "/items" in url:
            return DummyResp()
        return DummyRespFiles()


def _setup_env(monkeypatch):
    monkeypatch.setenv("SYNERGY_BASE_URL", "https://example.com")
    monkeypatch.setenv("SYNERGY_PAT_SECRET_NAME", "synergy/pat")
    monkeypatch.setenv("S3_BUCKET", "bucket")
    monkeypatch.setenv("S3_PREFIX", "prefix/")


def test_handler_probe_mode(monkeypatch):
    _setup_env(monkeypatch)
    monkeypatch.delenv("SYNC_MODE", raising=False)

    lf.secrets = DummySecrets()
    lf.s3 = DummyS3()
    lf.make_session = lambda: DummySession()

    event = {
        "mode": "probe",
        "rangeStart": 1,
        "rangeEnd": 1,
        "chunkSize": 1,
        "serverId": 1,
    }
    out = lf.handler(event, None)
    assert out["statusCode"] == 200
    assert out["body"]["probe"]["startId"] == 1
    assert out["body"]["totals"]["folders"] == 1


def test_handler_legacy_mode(monkeypatch):
    _setup_env(monkeypatch)
    monkeypatch.setenv("SYNC_MODE", "legacy")

    lf.secrets = DummySecrets()
    lf.s3 = DummyS3()
    lf.make_session = lambda: DummySession()

    event = {"mode": "legacy", "startFolderIdString": "3_1"}
    out = lf.handler(event, None)
    assert out["statusCode"] == 200
    assert "totals" in out["body"]
