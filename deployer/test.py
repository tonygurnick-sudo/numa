import unittest
from unittest.mock import patch

import streamlit as st

from app import (
    initialize_session_state,
    load_secret_and_select_account,
    retrieve_oauth2_token,
)


class TestStreamlitApp(unittest.TestCase):

    def setUp(self):
        """Setup session state before each test."""
        st.session_state.clear()

    def test_initialize_session_state(self):
        """Test session state initialization."""
        initialize_session_state()
        self.assertIsNone(st.session_state.aws_credentials)
        self.assertIsNone(st.session_state.idc_jwt_token)
        self.assertEqual(st.session_state.debug_logs, [])
        self.assertIsNone(st.session_state.q_app_response)
        self.assertIsNone(st.session_state.token)
        self.assertIsNone(st.session_state.selected_account)
        self.assertIsNone(st.session_state.secret_data)
        self.assertFalse(st.session_state.credentials_selected)

    @patch("app.auth.load_secret")
    def test_load_secret_and_select_account(self, mock_load_secret):
        """Test secret loading and account selection."""
        # Simulate secret data
        mock_load_secret.return_value = {"account1": {"key": "value"}}
        initialize_session_state()

        # Run the function
        load_secret_and_select_account("dummy_secret_name")

        self.assertIsNotNone(st.session_state.secret_data)
        self.assertIn("account1", st.session_state.secret_data)

    @patch("app.auth.configure_oauth_component")
    @patch("app.auth.handle_oauth2_token_retrieval_headless")
    @patch("streamlit.write")
    @patch("streamlit.error")
    def test_retrieve_oauth2_token(
        self, mock_error, _mock_write, mock_handle_oauth, mock_oauth_config
    ):
        """Test OAuth2 token retrieval."""
        initialize_session_state()
        st.session_state.credentials_selected = True
        st.session_state.selected_account = "account1"

        mock_oauth_config.return_value = (
            None  # Simulate OAuth configuration failure
        )
        retrieve_oauth2_token()
        mock_error.assert_called_with(
            "OAuth2 component could not be configured. Please check your OAUTH_CONFIG."
        )

        mock_oauth_config.return_value = (
            True  # Simulate OAuth configuration success
        )
        retrieve_oauth2_token()
        mock_handle_oauth.assert_called()


if __name__ == "__main__":
    unittest.main()
