import importlib
import os
import unittest


def _load_module(env: dict):
    """(Re)import lambda_function with a controlled environment.

    The module reads configuration into module-level constants at import time,
    so each scenario needs a fresh import under the desired env.
    """
    saved = {
        k: os.environ.get(k)
        for k in (
            "COGNITO_USER_POOL_ID",
            "COGNITO_CLIENT_ID",
            "ADDITIONAL_COGNITO_CLIENT_IDS",
        )
    }
    try:
        for key in saved:
            os.environ.pop(key, None)
        os.environ.update(env)
        import lambda_function

        return importlib.reload(lambda_function)
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class DummyTest(unittest.TestCase):
    def test_dummy(self):
        always_true = True
        self.assertTrue(always_true)


class SecurityHardeningTest(unittest.TestCase):
    """Covers the fail-closed fixes: BUG-007 and BUG-259."""

    def test_extract_user_sub_fails_closed_without_pool_id(self):
        # BUG-007: with no COGNITO_USER_POOL_ID we must reject (401) rather than
        # fall back to an unverified decode that accepts any token.
        mod = _load_module({"COGNITO_CLIENT_ID": "client-abc"})
        # A structurally-valid but unsigned JWT (header.payload.signature).
        forged = (
            "eyJhbGciOiJub25lIn0."  # {"alg":"none"}
            "eyJzdWIiOiJhdHRhY2tlciJ9."  # {"sub":"attacker"}
            "sig"
        )
        with self.assertRaises(mod.HTTPException) as ctx:
            mod.extract_user_sub(f"Bearer {forged}")
        self.assertEqual(ctx.exception.status_code, 401)

    def test_allowed_client_ids_drops_empty_strings(self):
        # BUG-259: an unset client id must not leave "" in the audience set,
        # which would make PyJWT skip audience validation.
        mod = _load_module({"COGNITO_CLIENT_ID": ""})
        self.assertNotIn("", mod.ALLOWED_CLIENT_IDS)
        self.assertEqual(mod.ALLOWED_CLIENT_IDS, set())

    def test_allowed_client_ids_keeps_real_ids(self):
        mod = _load_module(
            {
                "COGNITO_CLIENT_ID": "primary",
                "ADDITIONAL_COGNITO_CLIENT_IDS": "extra-1, ,extra-2",
            }
        )
        self.assertEqual(mod.ALLOWED_CLIENT_IDS, {"primary", "extra-1", "extra-2"})

    def test_redirect_slashes_disabled(self):
        # BUG-178: trailing-slash redirects leak the Function URL origin.
        mod = _load_module({"COGNITO_CLIENT_ID": "client-abc"})
        self.assertFalse(mod.app.router.redirect_slashes)


if __name__ == "__main__":
    unittest.main()
