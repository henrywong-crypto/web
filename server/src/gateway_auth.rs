use anyhow::{Context, Result};
use axum::{
    Json,
    extract::State,
    response::{IntoResponse, Response},
};
use chat_settings::{build_api_key_settings_json, set_vm_settings};
use serde::Deserialize;
use tower_sessions::Session;
use tracing::warn;

use crate::{
    handlers::UserVm,
    state::{AppConfig, AppError, AppState},
};

/// Builds the Pool B (gateway Cognito) authorize URL and stores a random `state`
/// nonce in the session. The `identity_provider` hint triggers silent SSO so users
/// who already authenticated with Pool A won't see a second login prompt.
pub(crate) async fn initiate_gateway_login(
    session: &Session,
    config: &AppConfig,
) -> Result<String> {
    let state_nonce = uuid::Uuid::new_v4().to_string();
    session
        .insert("gateway_oauth_state", &state_nonce)
        .await
        .context("failed to store gateway oauth state in session")?;

    let authorize_url = format!(
        "https://{}.auth.{}.amazoncognito.com/oauth2/authorize?\
         response_type=code\
         &client_id={}\
         &redirect_uri={}\
         &scope=openid+email\
         &state={}\
         &identity_provider={}",
        config.gateway_cognito_domain,
        config.gateway_cognito_region,
        config.gateway_cognito_client_id,
        urlencoding::encode(&config.gateway_cognito_redirect_uri),
        state_nonce,
        urlencoding::encode(&config.gateway_identity_provider),
    );

    Ok(authorize_url)
}

/// Exchanges an authorization code for an access token at Pool B's token endpoint.
pub(crate) async fn exchange_gateway_code(
    code: &str,
    config: &AppConfig,
) -> Result<String> {
    let token_url = format!(
        "https://{}.auth.{}.amazoncognito.com/oauth2/token",
        config.gateway_cognito_domain, config.gateway_cognito_region
    );

    let client = reqwest::Client::new();
    let resp = client
        .post(&token_url)
        .basic_auth(
            &config.gateway_cognito_client_id,
            Some(&config.gateway_cognito_client_secret),
        )
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &config.gateway_cognito_redirect_uri),
        ])
        .send()
        .await
        .context("failed to call gateway cognito token endpoint")?
        .error_for_status()
        .context("gateway cognito token endpoint returned error")?;

    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
    }

    let token_resp: TokenResponse = resp
        .json()
        .await
        .context("failed to parse gateway cognito token response")?;

    Ok(token_resp.access_token)
}

/// Calls the gateway's `POST /api/v1/api-keys` endpoint with a Bearer token.
/// Returns the provisioned API key string.
pub(crate) async fn provision_gateway_api_key(
    access_token: &str,
    gateway_api_url: &str,
    force_new: bool,
) -> Result<String> {
    let url = if force_new {
        format!("{}/api/v1/api-keys?force_new=true", gateway_api_url)
    } else {
        format!("{}/api/v1/api-keys", gateway_api_url)
    };

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .context("failed to build HTTP client")?;
    let resp = client
        .post(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .context("failed to call gateway api-keys endpoint")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("gateway api-keys endpoint returned {status}: {body}");
    }

    #[derive(Deserialize)]
    struct ApiKeyResponse {
        api_key: String,
    }

    let key_resp: ApiKeyResponse = resp
        .json()
        .await
        .context("failed to parse gateway api-keys response")?;

    Ok(key_resp.api_key)
}

/// Returns true if the gateway federation is configured.
pub(crate) fn is_gateway_configured(config: &AppConfig) -> bool {
    !config.gateway_cognito_client_id.is_empty()
        && !config.gateway_api_url.is_empty()
        && !config.gateway_identity_provider.is_empty()
}

/// POST /api/renew-gateway-key
///
/// Renews the user's gateway API key. If a gateway access token is stored in
/// session, reuse it to provision a new key with `force_new=true`. Otherwise,
/// redirect through the gateway OAuth flow.
pub(crate) async fn renew_gateway_key_handler(
    user_vm: UserVm,
    session: Session,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    if !is_gateway_configured(&state.config) {
        return Ok((axum::http::StatusCode::BAD_REQUEST, "Gateway not configured").into_response());
    }

    // Try to reuse stored gateway access token
    if let Some(access_token) = session
        .get::<String>("gateway_access_token")
        .await
        .unwrap_or(None)
    {
        match provision_gateway_api_key(&access_token, &state.config.gateway_api_url, true).await {
            Ok(api_key) => {
                let content = build_api_key_settings_json(
                    &api_key,
                    state.config.anthropic_base_url.as_deref(),
                    &state.config.anthropic_default_haiku_model,
                    &state.config.anthropic_default_sonnet_model,
                    &state.config.anthropic_default_opus_model,
                    None,
                );
                set_vm_settings(
                    user_vm.guest_ip,
                    &state.config.ssh_key_path,
                    &state.config.ssh_user,
                    &state.config.vm_host_key_path,
                    &content,
                )
                .await?;
                // Store the new key in session for VM reset handling
                let _ = session.insert("gateway_api_key", &api_key).await;
                return Ok(Json(serde_json::json!({"status": "ok"})).into_response());
            }
            Err(e) => {
                warn!("stored gateway token expired or invalid, initiating re-auth: {e}");
            }
        }
    }

    // Token expired or missing — redirect through OAuth flow
    let authorize_url = initiate_gateway_login(&session, &state.config).await?;
    // Mark that this is a renew flow so callback knows
    let _ = session.insert("gateway_renew_flow", true).await;
    Ok(Json(serde_json::json!({"redirect": authorize_url})).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config(
        client_id: &str,
        api_url: &str,
        identity_provider: &str,
    ) -> AppConfig {
        AppConfig {
            gateway_cognito_client_id: client_id.to_string(),
            gateway_api_url: api_url.to_string(),
            gateway_identity_provider: identity_provider.to_string(),
            ..default_config()
        }
    }

    fn default_config() -> AppConfig {
        serde_json::from_str("{}").unwrap()
    }

    #[test]
    fn is_gateway_configured_all_set() {
        let config = make_config("client-id", "https://gw.example.com", "PoolA");
        assert!(is_gateway_configured(&config));
    }

    #[test]
    fn is_gateway_configured_missing_client_id() {
        let config = make_config("", "https://gw.example.com", "PoolA");
        assert!(!is_gateway_configured(&config));
    }

    #[test]
    fn is_gateway_configured_missing_api_url() {
        let config = make_config("client-id", "", "PoolA");
        assert!(!is_gateway_configured(&config));
    }

    #[test]
    fn is_gateway_configured_missing_identity_provider() {
        let config = make_config("client-id", "https://gw.example.com", "");
        assert!(!is_gateway_configured(&config));
    }

    #[test]
    fn is_gateway_configured_all_empty() {
        let config = default_config();
        assert!(!is_gateway_configured(&config));
    }
}
