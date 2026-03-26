use anyhow::Context;
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chat_settings::{get_vm_claude_json_raw, set_vm_claude_json, upsert_mcp_server};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tower_sessions::Session;
use tracing::{error, info};
use url::Url;

use crate::{
    auth::User,
    state::{AppError, AppState, find_user_vm},
};

// ── PKCE helpers ─────────────────────────────────────────────────────────

/// Generate a cryptographically random code_verifier (43–128 chars, unreserved charset).
fn generate_code_verifier() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Compute S256 code_challenge from a code_verifier.
fn compute_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

/// Generate a random state nonce for CSRF protection.
fn generate_state() -> String {
    let bytes: [u8; 16] = rand::rng().random();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Extract the base URL (scheme + host + port) from an MCP server URL.
fn base_url(mcp_url: &str) -> Result<String, url::ParseError> {
    let parsed = Url::parse(mcp_url)?;
    let mut base = format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap_or(""));
    if let Some(port) = parsed.port() {
        base.push_str(&format!(":{port}"));
    }
    Ok(base)
}

// ── Types ────────────────────────────────────────────────────────────────

/// OAuth 2.0 Authorization Server Metadata (subset we care about).
#[derive(Deserialize, Serialize, Clone, Debug)]
struct OAuthMetadata {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    registration_endpoint: Option<String>,
    #[serde(default)]
    scopes_supported: Option<Vec<String>>,
}

#[derive(Serialize)]
struct DiscoverResponse {
    oauth: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<OAuthMetadata>,
}

#[derive(Deserialize)]
pub(crate) struct DiscoverQuery {
    url: String,
}

#[derive(Deserialize)]
pub(crate) struct RegisterBody {
    registration_endpoint: String,
    client_name: String,
    redirect_uri: String,
}

#[derive(Deserialize, Serialize)]
struct RegisterResponse {
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct OAuthStartBody {
    authorization_endpoint: String,
    token_endpoint: String,
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
    #[serde(default)]
    scopes: Option<String>,
    mcp_url: String,
    server_name: String,
}

#[derive(Deserialize)]
pub(crate) struct OAuthCallbackQuery {
    code: String,
    state: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
}

// ── Handlers ─────────────────────────────────────────────────────────────

/// GET /api/mcp-servers/oauth-discover?url=<mcp_url>
///
/// Probe an MCP server for OAuth authorization server metadata.
pub(crate) async fn discover_handler(
    Query(query): Query<DiscoverQuery>,
) -> Result<Response, AppError> {
    let base = base_url(&query.url).map_err(|_| anyhow::anyhow!("invalid URL"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build HTTP client: {e}"))?;

    // Try RFC 8414 well-known endpoint
    let well_known_url = format!("{base}/.well-known/oauth-authorization-server");
    let resp = client.get(&well_known_url).send().await;

    if let Ok(resp) = resp {
        if resp.status().is_success() {
            if let Ok(metadata) = resp.json::<OAuthMetadata>().await {
                return Ok(Json(DiscoverResponse {
                    oauth: true,
                    metadata: Some(metadata),
                })
                .into_response());
            }
        }
    }

    // Fallback: check if /authorize endpoint exists
    let fallback_auth = format!("{base}/authorize");
    let fallback_resp = client.get(&fallback_auth).send().await;
    if let Ok(resp) = fallback_resp {
        // If it returns anything other than 404, assume OAuth is available
        if resp.status() != StatusCode::NOT_FOUND {
            let metadata = OAuthMetadata {
                authorization_endpoint: fallback_auth,
                token_endpoint: format!("{base}/token"),
                registration_endpoint: Some(format!("{base}/register")),
                scopes_supported: None,
            };
            return Ok(Json(DiscoverResponse {
                oauth: true,
                metadata: Some(metadata),
            })
            .into_response());
        }
    }

    Ok(Json(DiscoverResponse {
        oauth: false,
        metadata: None,
    })
    .into_response())
}

/// POST /api/mcp-servers/oauth-register
///
/// Dynamic Client Registration per RFC 7591.
pub(crate) async fn register_handler(
    Json(body): Json<RegisterBody>,
) -> Result<Response, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build HTTP client: {e}"))?;

    let reg_request = serde_json::json!({
        "client_name": body.client_name,
        "redirect_uris": [body.redirect_uri],
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });

    let resp = client
        .post(&body.registration_endpoint)
        .json(&reg_request)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("registration request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Ok((
            StatusCode::BAD_GATEWAY,
            format!("registration failed: {status} {body_text}"),
        )
            .into_response());
    }

    let reg_resp: RegisterResponse = resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("failed to parse registration response: {e}"))?;

    Ok(Json(reg_resp).into_response())
}

/// POST /api/mcp-servers/oauth-start
///
/// Generate PKCE parameters, store state in session, return authorization URL.
pub(crate) async fn start_handler(
    session: Session,
    Json(body): Json<OAuthStartBody>,
) -> Result<Response, AppError> {
    let code_verifier = generate_code_verifier();
    let code_challenge = compute_code_challenge(&code_verifier);
    let state = generate_state();

    // Build redirect_uri from current origin — the callback route
    // We'll use a relative path and let the frontend construct the full URL
    let redirect_uri = "/callback/mcp-oauth";

    // Store OAuth state in session
    session
        .insert("mcp_oauth_state", &state)
        .await
        .context("failed to store mcp oauth state")?;
    session
        .insert("mcp_oauth_pkce_verifier", &code_verifier)
        .await
        .context("failed to store mcp oauth pkce verifier")?;
    session
        .insert("mcp_oauth_token_endpoint", &body.token_endpoint)
        .await
        .context("failed to store mcp oauth token endpoint")?;
    session
        .insert("mcp_oauth_client_id", &body.client_id)
        .await
        .context("failed to store mcp oauth client id")?;
    if let Some(ref secret) = body.client_secret {
        session
            .insert("mcp_oauth_client_secret", secret)
            .await
            .context("failed to store mcp oauth client secret")?;
    }
    session
        .insert("mcp_oauth_mcp_url", &body.mcp_url)
        .await
        .context("failed to store mcp oauth mcp url")?;
    session
        .insert("mcp_oauth_server_name", &body.server_name)
        .await
        .context("failed to store mcp oauth server name")?;

    // Build authorization URL
    let mut auth_url =
        Url::parse(&body.authorization_endpoint).context("invalid authorization endpoint URL")?;
    auth_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &body.client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);
    if let Some(ref scopes) = body.scopes {
        auth_url
            .query_pairs_mut()
            .append_pair("scope", scopes);
    }

    Ok(Json(serde_json::json!({ "redirect": auth_url.to_string() })).into_response())
}

/// GET /callback/mcp-oauth?code=...&state=...
///
/// Handle the OAuth callback: validate state, exchange code for token, store MCP server config.
pub(crate) async fn callback_handler(
    query: Query<OAuthCallbackQuery>,
    _user: User,
    session: Session,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    // Validate state nonce
    let stored_state = session
        .remove::<String>("mcp_oauth_state")
        .await
        .context("failed to retrieve oauth state from session")?;

    if stored_state.as_deref() != Some(&query.state) {
        error!("mcp oauth state mismatch");
        return Ok(Redirect::to("/?mcp_oauth=error").into_response());
    }

    // Retrieve session data
    let pkce_verifier = session
        .remove::<String>("mcp_oauth_pkce_verifier")
        .await
        .context("failed to retrieve pkce verifier")?
        .context("pkce verifier missing")?;
    let token_endpoint = session
        .remove::<String>("mcp_oauth_token_endpoint")
        .await
        .context("failed to retrieve token endpoint")?
        .context("token endpoint missing")?;
    let client_id = session
        .remove::<String>("mcp_oauth_client_id")
        .await
        .context("failed to retrieve client id")?
        .context("client id missing")?;
    let client_secret = session
        .remove::<String>("mcp_oauth_client_secret")
        .await
        .unwrap_or(None);
    let mcp_url = session
        .remove::<String>("mcp_oauth_mcp_url")
        .await
        .context("failed to retrieve mcp url")?
        .context("mcp url missing")?;
    let server_name = session
        .remove::<String>("mcp_oauth_server_name")
        .await
        .context("failed to retrieve server name")?
        .context("server name missing")?;

    // Exchange authorization code for tokens
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build HTTP client: {e}"))?;

    let mut token_params = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", query.code.clone()),
        ("redirect_uri", "/callback/mcp-oauth".to_string()),
        ("code_verifier", pkce_verifier),
        ("client_id", client_id),
    ];
    if let Some(secret) = client_secret {
        token_params.push(("client_secret", secret));
    }

    let token_resp = http_client
        .post(&token_endpoint)
        .form(&token_params)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("token exchange failed: {e}"))?;

    if !token_resp.status().is_success() {
        let status = token_resp.status();
        let body = token_resp.text().await.unwrap_or_default();
        error!("token exchange failed: {status} {body}");
        return Ok(Redirect::to("/?mcp_oauth=error").into_response());
    }

    let tokens: TokenResponse = token_resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("failed to parse token response: {e}"))?;

    info!("mcp oauth token exchange successful for server: {server_name}");

    // Find user's VM to write the config
    let user_email = session
        .get::<String>("user_email")
        .await
        .ok()
        .flatten();
    let user_id = if let Some(email) = &user_email {
        store::get_user_by_email(&state.db, email)
            .await
            .ok()
            .flatten()
            .map(|u| u.id)
    } else {
        None
    };

    if let Some(user_id) = user_id {
        if let Ok(Some(vm_info)) = find_user_vm(&state.vms, user_id) {
            // Read current ~/.claude.json from VM
            let raw = get_vm_claude_json_raw(
                vm_info.guest_ip,
                &state.config.ssh_key_path,
                &state.config.ssh_user,
                &state.config.vm_host_key_path,
            )
            .await
            .unwrap_or_else(|_| "{}".to_string());

            // Build MCP server entry with OAuth token
            let mut server = serde_json::json!({
                "type": "http",
                "url": mcp_url,
                "headers": {
                    "Authorization": format!("Bearer {}", tokens.access_token),
                },
            });
            if let Some(ref refresh) = tokens.refresh_token {
                server["_refresh_token"] = serde_json::Value::String(refresh.clone());
            }

            // Upsert and write back
            if let Ok(updated) = upsert_mcp_server(raw.trim(), &server_name, server) {
                let _ = set_vm_claude_json(
                    vm_info.guest_ip,
                    &state.config.ssh_key_path,
                    &state.config.ssh_user,
                    &state.config.vm_host_key_path,
                    &updated,
                )
                .await;
            }
        }
    }

    Ok(Redirect::to("/?mcp_oauth=success").into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── PKCE tests ──────────────────────────────────────────────────────

    #[test]
    fn code_verifier_has_valid_length() {
        let verifier = generate_code_verifier();
        // 32 bytes → 43 base64url chars (no padding)
        assert_eq!(verifier.len(), 43);
    }

    #[test]
    fn code_verifier_is_url_safe() {
        let verifier = generate_code_verifier();
        assert!(verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn code_challenge_is_deterministic_for_same_verifier() {
        let challenge1 = compute_code_challenge("test_verifier_123");
        let challenge2 = compute_code_challenge("test_verifier_123");
        assert_eq!(challenge1, challenge2);
    }

    #[test]
    fn code_challenge_differs_for_different_verifiers() {
        let c1 = compute_code_challenge("verifier_a");
        let c2 = compute_code_challenge("verifier_b");
        assert_ne!(c1, c2);
    }

    #[test]
    fn code_challenge_is_base64url_encoded() {
        let challenge = compute_code_challenge("my_verifier");
        assert!(challenge
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        // SHA256 → 32 bytes → 43 base64url chars
        assert_eq!(challenge.len(), 43);
    }

    // ── State tests ─────────────────────────────────────────────────────

    #[test]
    fn state_nonce_has_valid_length() {
        let state = generate_state();
        // 16 bytes → 22 base64url chars
        assert_eq!(state.len(), 22);
    }

    #[test]
    fn state_nonce_is_url_safe() {
        let state = generate_state();
        assert!(state
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn state_nonces_are_unique() {
        let s1 = generate_state();
        let s2 = generate_state();
        assert_ne!(s1, s2);
    }

    // ── base_url tests ──────────────────────────────────────────────────

    #[test]
    fn base_url_strips_path() {
        assert_eq!(
            base_url("https://api.example.com/v1/mcp").unwrap(),
            "https://api.example.com"
        );
    }

    #[test]
    fn base_url_preserves_port() {
        assert_eq!(
            base_url("https://localhost:8443/mcp").unwrap(),
            "https://localhost:8443"
        );
    }

    #[test]
    fn base_url_handles_no_path() {
        assert_eq!(
            base_url("https://mcp.figma.com").unwrap(),
            "https://mcp.figma.com"
        );
    }

    #[test]
    fn base_url_rejects_invalid_url() {
        assert!(base_url("not a url").is_err());
    }

    #[test]
    fn base_url_strips_query_and_fragment() {
        assert_eq!(
            base_url("https://example.com/mcp?key=val#frag").unwrap(),
            "https://example.com"
        );
    }
}
