/**
 * Generate Swagger UI configuration with Cognito authentication
 */

export interface SwaggerConfigOptions {
  clientName: string;
  apiBaseUrl: string;
  cognitoUserPoolId: string;
  cognitoUserPoolClientId: string;
}

/**
 * Generate Swagger UI configuration JavaScript code
 * This handles Cognito authentication integration
 */
export function generateSwaggerConfig(options: SwaggerConfigOptions): string {
  const { apiBaseUrl, cognitoUserPoolId, cognitoUserPoolClientId } = options;

  return `
    // Cognito Authentication Configuration
    const cognitoConfig = {
      userPoolId: '${cognitoUserPoolId}',
      userPoolClientId: '${cognitoUserPoolClientId}',
      region: '${cognitoUserPoolId?.split('_')[0] || 'us-east-1'}'
    };

    // Authentication state
    let currentToken = null;
    let tokenExpiry = null;

    // Add authentication UI
    function addAuthUI() {
      const topbar = document.querySelector('.topbar-wrapper');
      if (!topbar || document.getElementById('auth-container')) return;

      const authContainer = document.createElement('div');
      authContainer.id = 'auth-container';
      authContainer.style.cssText = \`
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 9999;
        background: white;
        padding: 10px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
      \`;

      updateAuthUI(authContainer);
      document.body.appendChild(authContainer);
    }

    function updateAuthUI(container) {
      const isAuthenticated = currentToken && tokenExpiry && new Date() < tokenExpiry;

      if (isAuthenticated) {
        container.innerHTML = \`
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="color: #28a745;">🟢 Authenticated</span>
            <button onclick="logout()" style="
              background: #dc3545;
              color: white;
              border: none;
              padding: 4px 8px;
              border-radius: 3px;
              cursor: pointer;
              font-size: 12px;
            ">Logout</button>
          </div>
        \`;
      } else {
        container.innerHTML = \`
          <div style="display: flex; flex-direction: column; gap: 8px; min-width: 200px;">
            <div style="font-weight: bold;">Authenticate for API Testing</div>
            <input type="email" id="email-input" placeholder="Email" style="
              padding: 6px;
              border: 1px solid #ddd;
              border-radius: 3px;
              font-size: 14px;
            " />
            <input type="password" id="password-input" placeholder="Password" style="
              padding: 6px;
              border: 1px solid #ddd;
              border-radius: 3px;
              font-size: 14px;
            " />
            <button onclick="authenticate()" style="
              background: #007bff;
              color: white;
              border: none;
              padding: 6px;
              border-radius: 3px;
              cursor: pointer;
            ">Login</button>
            <div id="auth-status" style="font-size: 12px; color: #666;"></div>
          </div>
        \`;
      }
    }

    // Cognito authentication functions (simplified for demo)
    window.authenticate = async function() {
      const email = document.getElementById('email-input')?.value;
      const password = document.getElementById('password-input')?.value;
      const statusEl = document.getElementById('auth-status');

      if (!email || !password) {
        statusEl.textContent = 'Please enter email and password';
        statusEl.style.color = '#dc3545';
        return;
      }

      statusEl.textContent = 'Authenticating...';
      statusEl.style.color = '#666';

      try {
        // This is a simplified example - in a real implementation,
        // you would use the AWS Cognito SDK to authenticate
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        if (response.ok) {
          const data = await response.json();
          currentToken = data.token;
          tokenExpiry = new Date(Date.now() + (data.expiresIn || 3600) * 1000);

          // Update Swagger UI authorization
          ui.preauthorizeApiKey('CognitoAuth', \`Bearer \${currentToken}\`);

          statusEl.textContent = 'Authentication successful!';
          statusEl.style.color = '#28a745';

          setTimeout(() => {
            updateAuthUI(document.getElementById('auth-container'));
          }, 1000);
        } else {
          throw new Error('Authentication failed');
        }
      } catch (error) {
        statusEl.textContent = 'Authentication failed. Please check credentials.';
        statusEl.style.color = '#dc3545';
        console.error('Auth error:', error);
      }
    };

    window.logout = function() {
      currentToken = null;
      tokenExpiry = null;
      ui.preauthorizeApiKey('CognitoAuth', null);
      updateAuthUI(document.getElementById('auth-container'));
    };

    // Request interceptor to add CloudFront secret
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
      // Add CloudFront secret header for API requests
      if (url.startsWith('/api/') || url.startsWith('${apiBaseUrl}')) {
        options.headers = {
          ...options.headers,
          'x-arcanum-cloudfront-secret': 'auto-injected-by-cloudfront'
        };

        // Add auth token if available
        if (currentToken && (!tokenExpiry || new Date() < tokenExpiry)) {
          options.headers.Authorization = \`Bearer \${currentToken}\`;
        }
      }

      return originalFetch(url, options);
    };

    // Initialize auth UI after Swagger loads
    setTimeout(addAuthUI, 1000);

    // Periodically check token expiry
    setInterval(() => {
      if (tokenExpiry && new Date() >= tokenExpiry) {
        window.logout();
      }
    }, 60000); // Check every minute
  `;
}
